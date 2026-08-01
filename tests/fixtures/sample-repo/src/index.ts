/**
 * Entry point for the sample repository.
 */
import { authenticate } from "./auth";
import { hashPassword, formatToken } from "./utils";

export function main(): void {
  const user = authenticate("alice", "secret");
  console.log(formatToken(hashPassword(user)));
}

main();
