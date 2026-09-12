/** Authored demo inputs, never presented as real customer submissions. */
export const feedbackBatchScenarios = [
  { category: 'general' as const, names: ['Maya', 'Alex'], title: 'Empty contact export fails', text: 'Exporting an empty contact list shows an error instead of a CSV download. Empty exports should still include the name and email column headers.' },
  { category: 'ui_ux' as const, names: ['Sam', 'Jordan'], title: 'Feedback confirmation is easy to miss', text: 'After I send feedback, the thank-you message is small and appears below the submit button. Please make the successful submission clearly visible with a distinct confirmation panel, while allowing me to send more feedback.' },
  { category: 'performance' as const, names: ['Taylor', 'Riley'], title: 'Feedback page repeatedly loads engineering data', text: 'The public feedback page repeatedly requests the full engineering task list while idle, even though it does not display it. Please stop polling hidden engineering data on the public page while keeping the engineer console updated.' },
];
