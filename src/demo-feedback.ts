/** Authored sample data. Scenario IDs group known demo issues; Codex produces their summaries. */
const firstNames = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Riley', 'Casey', 'Morgan', 'Jamie', 'Avery', 'Robin'];
const lastNames = ['Chen', 'Patel', 'Rivera', 'Park', 'Shah', 'Wilson', 'Martin', 'Kim', 'Singh', 'Garcia', 'Reed', 'Brooks'];
const scenarios = [
  { category: 'general' as const, title: 'Empty contact export fails', variants: [
    'Exporting an empty contact list gives me an error. I expected a CSV with the column headers, even without any contacts.',
    'I tried downloading a CSV before adding any contacts and it failed. A blank template with name and email headers would help.',
    'The export breaks when my list has zero contacts. Could it download an empty CSV instead of showing an error?',
    'An empty contact list should still export. Right now I get an error rather than a file with the name and email columns.',
  ] },
  { category: 'ui_ux' as const, title: 'Feedback confirmation is easy to miss', variants: [
    'I sent feedback but almost missed the small thank-you text below the button. A clear confirmation panel would be reassuring.',
    'After submitting, I could not immediately tell whether my feedback was received. Please make the success message more visible.',
    'The thank-you message is easy to overlook. I would like a distinct confirmation after sending, with a way to submit more feedback.',
    'I nearly submitted the same feedback twice because the confirmation was so subtle. A more prominent success state would help.',
  ] },
  { category: 'performance' as const, title: 'Unnecessary requests on the feedback page', variants: [
    'The public feedback page keeps fetching the full engineering task list while idle. It should only load data that this page uses.',
    'I noticed repeated task-list requests on the customer page, although no tasks are displayed. Can those background requests stop?',
    'The feedback page polls engineering data every few seconds while I am just writing. Please keep that polling in the engineer view.',
    'There are unnecessary task-list requests while the public page is open. Keep the team dashboard live, but spare the customer page.',
  ] },
];
export const feedbackBatchScenarios = scenarios.map((scenario, group) => {
  const reviews = Array.from({length: 40}, (_, index) => {
    const person = index * 3 + group;
    return {name: `${firstNames[person % 10]} ${lastNames[Math.floor(person / 10)]}`, text: scenario.variants[index % scenario.variants.length]!};
  });
  return {category: scenario.category, title: scenario.title, text: scenario.variants[0]!, names: reviews.map(review=>review.name), reviews};
});
export function datedFeedbackScenarios(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return feedbackBatchScenarios.map((scenario, group) => ({...scenario, reviews: scenario.reviews.map((review,index) => ({
    ...review, postedAt: new Date(now.getTime() - (now.getTime()-start) * (index*3+group)/120).toISOString(),
  }))}));
}
