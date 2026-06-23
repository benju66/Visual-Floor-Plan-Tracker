// Unique id generator — mirrors the prototype's `'r' + Date.now()36 + '-' + counter`.

let counter = 0;

export function uid(): string {
  return "r" + Date.now().toString(36) + "-" + ++counter;
}

export function groupId(): string {
  return "g" + Date.now().toString(36) + "-" + ++counter;
}

export function doneGroupId(): string {
  return "done-" + Date.now().toString(36) + "-" + ++counter;
}
