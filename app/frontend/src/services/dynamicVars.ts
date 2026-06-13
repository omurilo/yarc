// Postman-style dynamic variables resolved at send time: {{$guid}}, {{$timestamp}}, {{$randomX}}…
// Mirrors the Go backend's applyDynamicVariables so previews/snippets/the browser proxy match.

const firstNames = ["Ada", "Linus", "Grace", "Alan", "Dennis", "Margaret", "Ken", "Barbara"];
const lastNames = ["Lovelace", "Torvalds", "Hopper", "Turing", "Ritchie", "Hamilton", "Thompson", "Liskov"];
const colors = ["red", "green", "blue", "yellow", "purple", "cyan"];

const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
const randInt = (max: number) => Math.floor(Math.random() * max);

function dynamicValue(name: string): string | undefined {
  switch (name) {
    case "guid":
    case "randomUUID":
      return crypto.randomUUID();
    case "timestamp":
      return String(Math.floor(Date.now() / 1000));
    case "isoTimestamp":
      return new Date().toISOString();
    case "randomInt":
      return String(randInt(1001));
    case "randomBoolean":
      return String(randInt(2) === 1);
    case "randomFirstName":
      return pick(firstNames);
    case "randomLastName":
      return pick(lastNames);
    case "randomFullName":
      return `${pick(firstNames)} ${pick(lastNames)}`;
    case "randomEmail":
      return `${pick(firstNames).toLowerCase()}.${pick(lastNames).toLowerCase()}${randInt(1000)}@example.com`;
    case "randomUserName":
      return `${pick(firstNames).toLowerCase()}_${randInt(1000)}`;
    case "randomColor":
      return pick(colors);
    default:
      return undefined;
  }
}

export function applyDynamicVars(value: string): string {
  if (!value.includes("{{$")) return value;
  return value.replace(/\{\{\$(\w+)\}\}/g, (match, name: string) => dynamicValue(name) ?? match);
}
