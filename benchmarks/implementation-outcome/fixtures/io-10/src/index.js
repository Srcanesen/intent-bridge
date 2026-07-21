import { resolve } from "node:path";
export function safeJoin(root, candidate) {
  return resolve(root, candidate);
}
