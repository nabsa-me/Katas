import { classifyIssue, type TextModel } from './classifier';

/**
 * Flawed: how an AI feature is often "evaluated" before an eval exists. Someone runs a few examples after each
 * prompt change, reads the answers and decides they look fine.
 */
export async function spotCheck(model: TextModel, print: (line: string) => void = console.log): Promise<number> {
  // BUG: three easy examples picked by the author: no incident against bug, no security, no other language, no
  // empty description, no instructions hidden in the text. The cases that break are exactly the ones not here.
  const examples = ['The login button does nothing', 'Add dark mode to the dashboard', 'Upgrade the dependencies'];
  for (const summary of examples) {
    const reply = await classifyIssue({ summary, description: '' }, model);
    // BUG: no expected answer. Whoever reads the output decides whether it is right, and nobody reads it in CI.
    print(`${summary} -> ${reply.text}`);
  }
  // BUG: always succeeds, so a regression never fails the pipeline; and latency, tokens and cost are not measured.
  return 0;
}
