package grpc

import (
	"context"
	"crypto/tls"
	"fmt"
	"strings"
	"time"

	"github.com/bufbuild/protocompile"
	"github.com/jhump/protoreflect/v2/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// ProtoMethod describes a single unary or streaming RPC method, sourced either
// from a parsed .proto file or from server reflection.
type ProtoMethod struct {
	Service         string `json:"service"`
	Method          string `json:"method"`
	FullMethod      string `json:"fullMethod"`
	RequestType     string `json:"requestType"`
	ResponseType    string `json:"responseType"`
	ClientStreaming bool   `json:"clientStreaming"`
	ServerStreaming bool   `json:"serverStreaming"`
}

// Request carries everything needed to list methods or invoke an RPC. The
// service descriptors come from server reflection when UseReflection is set,
// otherwise from the in-memory .proto source.
type Request struct {
	Target        string            `json:"target"`
	FullMethod    string            `json:"fullMethod"`
	RequestJSON   string            `json:"requestJSON"`
	Metadata      map[string]string `json:"metadata"`
	ProtoFilename string            `json:"protoFilename"`
	ProtoSource   string            `json:"protoSource"`
	UseReflection bool              `json:"useReflection"`
	Plaintext     bool              `json:"plaintext"`
	TimeoutMS     int64             `json:"timeoutMs"`
}

// MethodList is the result of listing methods. Error is non-empty when the
// proto source could not be parsed or reflection failed.
type MethodList struct {
	Methods []ProtoMethod `json:"methods"`
	Error   string        `json:"error"`
}

// InvokeResponse is the result of a unary invocation. StatusCode follows the
// gRPC status code numbering; Error carries the status message on failure.
type InvokeResponse struct {
	Body       string            `json:"body"`
	StatusCode int               `json:"statusCode"`
	Status     string            `json:"status"`
	Trailers   map[string]string `json:"trailers"`
	DurationMS int64             `json:"durationMs"`
	Error      string            `json:"error"`
}

// ListMethods resolves the available RPC methods for the request, parsing the
// proto source or querying server reflection.
func ListMethods(ctx context.Context, req Request) MethodList {
	services, err := resolveServices(ctx, req)
	if err != nil {
		return MethodList{Methods: []ProtoMethod{}, Error: err.Error()}
	}
	return MethodList{Methods: methodsFromServices(services)}
}

// Invoke performs a unary gRPC call and returns the response body as JSON.
func Invoke(ctx context.Context, req Request) InvokeResponse {
	start := time.Now()

	timeout := 30 * time.Second
	if req.TimeoutMS > 0 {
		timeout = time.Duration(req.TimeoutMS) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	conn, err := dial(req.Target, req.Plaintext)
	if err != nil {
		return errorResponse(err, start)
	}
	defer conn.Close()

	method, err := resolveMethod(ctx, conn, req)
	if err != nil {
		return errorResponse(err, start)
	}

	if method.IsStreamingClient() || method.IsStreamingServer() {
		return InvokeResponse{
			Trailers:   map[string]string{},
			DurationMS: time.Since(start).Milliseconds(),
			Error:      "Streaming methods are not supported yet — only unary RPCs can be invoked.",
		}
	}

	request := dynamicpb.NewMessage(method.Input())
	if strings.TrimSpace(req.RequestJSON) != "" {
		if err := protojson.Unmarshal([]byte(req.RequestJSON), request); err != nil {
			return errorResponse(fmt.Errorf("invalid request JSON: %w", err), start)
		}
	}

	if len(req.Metadata) > 0 {
		pairs := make([]string, 0, len(req.Metadata)*2)
		for key, value := range req.Metadata {
			if key == "" {
				continue
			}
			pairs = append(pairs, key, value)
		}
		ctx = metadata.AppendToOutgoingContext(ctx, pairs...)
	}

	response := dynamicpb.NewMessage(method.Output())
	var trailer metadata.MD
	path := fmt.Sprintf("/%s/%s", method.Parent().FullName(), method.Name())
	err = conn.Invoke(ctx, path, request, response, grpc.Trailer(&trailer))
	duration := time.Since(start).Milliseconds()
	if err != nil {
		st, _ := status.FromError(err)
		return InvokeResponse{
			StatusCode: int(st.Code()),
			Status:     st.Code().String(),
			Trailers:   flattenMetadata(trailer),
			DurationMS: duration,
			Error:      st.Message(),
		}
	}

	body, err := protojson.MarshalOptions{Multiline: true, Indent: "  "}.Marshal(response)
	if err != nil {
		return errorResponse(err, start)
	}

	return InvokeResponse{
		Body:       string(body),
		StatusCode: 0,
		Status:     "OK",
		Trailers:   flattenMetadata(trailer),
		DurationMS: duration,
	}
}

func resolveServices(ctx context.Context, req Request) ([]protoreflect.ServiceDescriptor, error) {
	if req.UseReflection {
		conn, err := dial(req.Target, req.Plaintext)
		if err != nil {
			return nil, err
		}
		defer conn.Close()
		return reflectionServices(ctx, conn)
	}
	return compileServices(ctx, req.ProtoFilename, req.ProtoSource)
}

func resolveMethod(ctx context.Context, conn *grpc.ClientConn, req Request) (protoreflect.MethodDescriptor, error) {
	serviceName, methodName, err := splitMethod(req.FullMethod)
	if err != nil {
		return nil, err
	}

	var service protoreflect.ServiceDescriptor
	if req.UseReflection {
		client := grpcreflect.NewClientAuto(ctx, conn)
		defer client.Reset()
		file, err := client.FileContainingSymbol(protoreflect.FullName(serviceName))
		if err != nil {
			return nil, fmt.Errorf("resolve service %q: %w", serviceName, err)
		}
		service = findService(file, protoreflect.FullName(serviceName))
		if service == nil {
			return nil, fmt.Errorf("service %q not found via reflection", serviceName)
		}
	} else {
		services, cerr := compileServices(ctx, req.ProtoFilename, req.ProtoSource)
		if cerr != nil {
			return nil, cerr
		}
		for _, candidate := range services {
			if string(candidate.FullName()) == serviceName || string(candidate.Name()) == serviceName {
				service = candidate
				break
			}
		}
		if service == nil {
			return nil, fmt.Errorf("service %q not found in proto", serviceName)
		}
	}

	method := service.Methods().ByName(protoreflect.Name(methodName))
	if method == nil {
		return nil, fmt.Errorf("method %q not found in service %q", methodName, serviceName)
	}
	return method, nil
}

func compileServices(ctx context.Context, filename string, source string) ([]protoreflect.ServiceDescriptor, error) {
	if strings.TrimSpace(source) == "" {
		return nil, fmt.Errorf("no proto source provided")
	}
	if filename == "" {
		filename = "schema.proto"
	}
	compiler := protocompile.Compiler{
		Resolver: protocompile.WithStandardImports(&protocompile.SourceResolver{
			Accessor: protocompile.SourceAccessorFromMap(map[string]string{filename: source}),
		}),
	}
	files, err := compiler.Compile(ctx, filename)
	if err != nil {
		return nil, fmt.Errorf("parse proto: %w", err)
	}
	services := []protoreflect.ServiceDescriptor{}
	for _, file := range files {
		descriptors := file.Services()
		for i := 0; i < descriptors.Len(); i++ {
			services = append(services, descriptors.Get(i))
		}
	}
	return services, nil
}

func reflectionServices(ctx context.Context, conn *grpc.ClientConn) ([]protoreflect.ServiceDescriptor, error) {
	client := grpcreflect.NewClientAuto(ctx, conn)
	defer client.Reset()

	names, err := client.ListServices()
	if err != nil {
		return nil, fmt.Errorf("server reflection: %w", err)
	}

	services := []protoreflect.ServiceDescriptor{}
	for _, name := range names {
		if name == "grpc.reflection.v1.ServerReflection" || name == "grpc.reflection.v1alpha.ServerReflection" {
			continue
		}
		file, err := client.FileContainingSymbol(name)
		if err != nil {
			continue
		}
		if service := findService(file, name); service != nil {
			services = append(services, service)
		}
	}
	return services, nil
}

func findService(file protoreflect.FileDescriptor, name protoreflect.FullName) protoreflect.ServiceDescriptor {
	descriptors := file.Services()
	for i := 0; i < descriptors.Len(); i++ {
		if descriptors.Get(i).FullName() == name {
			return descriptors.Get(i)
		}
	}
	return nil
}

func methodsFromServices(services []protoreflect.ServiceDescriptor) []ProtoMethod {
	methods := []ProtoMethod{}
	for _, service := range services {
		descriptors := service.Methods()
		for i := 0; i < descriptors.Len(); i++ {
			method := descriptors.Get(i)
			methods = append(methods, ProtoMethod{
				Service:         string(service.FullName()),
				Method:          string(method.Name()),
				FullMethod:      string(service.FullName()) + "/" + string(method.Name()),
				RequestType:     string(method.Input().FullName()),
				ResponseType:    string(method.Output().FullName()),
				ClientStreaming: method.IsStreamingClient(),
				ServerStreaming: method.IsStreamingServer(),
			})
		}
	}
	return methods
}

func dial(target string, plaintext bool) (*grpc.ClientConn, error) {
	if strings.TrimSpace(target) == "" {
		return nil, fmt.Errorf("target host is required")
	}
	var creds credentials.TransportCredentials
	if plaintext {
		creds = insecure.NewCredentials()
	} else {
		creds = credentials.NewTLS(&tls.Config{})
	}
	return grpc.NewClient(target, grpc.WithTransportCredentials(creds))
}

func splitMethod(fullMethod string) (string, string, error) {
	trimmed := strings.TrimSpace(strings.TrimPrefix(fullMethod, "/"))
	index := strings.LastIndex(trimmed, "/")
	if index <= 0 || index == len(trimmed)-1 {
		return "", "", fmt.Errorf("method must be in the form package.Service/Method")
	}
	return trimmed[:index], trimmed[index+1:], nil
}

func flattenMetadata(md metadata.MD) map[string]string {
	out := map[string]string{}
	for key, values := range md {
		out[key] = strings.Join(values, ", ")
	}
	return out
}

func errorResponse(err error, start time.Time) InvokeResponse {
	return InvokeResponse{
		StatusCode: 0,
		Status:     "Error",
		Trailers:   map[string]string{},
		DurationMS: time.Since(start).Milliseconds(),
		Error:      err.Error(),
	}
}
