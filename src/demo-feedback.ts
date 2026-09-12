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
  { category: 'ui_ux' as const, title: 'Contact status filter does not apply', variants: [
    'On the Contacts page, selecting Trial still shows Active contacts. The status filter should narrow the list.',
    'I selected Active in the contact status dropdown, but Trial contacts stayed in the results.',
    'The status selector changes its label but the list stays the same. Please filter contacts by the selected status.',
    'Searching by name works eventually, but selecting Trial does not narrow those search results by status.',
  ] },
  { category: 'performance' as const, title: 'Contact search is unnecessarily slow', variants: [
    'Searching for Ada on the Contacts page takes about two seconds even though there are only six contacts.',
    'Every time I type a name, Searching stays on screen for two seconds. This small list should update immediately.',
    'Contact search feels delayed on every keystroke. Clearing the search takes just as long to show everyone again.',
    'The contacts are already visible, but filtering by name waits two seconds after I stop typing. Please make search responsive.',
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
