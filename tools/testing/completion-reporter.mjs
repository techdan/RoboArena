/** Notify the E2E wrapper after reporting completes so it can stop Next on Windows. */

import process from "node:process";

export default class CompletionReporter {
  onEnd() {
    if (process.send !== undefined) process.send("playwright-tests-complete");
  }
}
