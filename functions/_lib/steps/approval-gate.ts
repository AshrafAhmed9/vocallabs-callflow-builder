// approval_gate step: no external call. Just tells the executor to pause
// the run and wait for approveStep.
export function runApprovalGate(): { output: any; pause: true } {
  return { output: { message: "Awaiting supervisor approval." }, pause: true };
}
