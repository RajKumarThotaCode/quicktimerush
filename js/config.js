// The public address of the game. It is painted on the court wall (so it shows in every clip and screenshot).
// Change it here if the game moves to a new domain, then run tools/deploy.sh.
export const SITE = 'rajkumarthotacode.github.io/quicktimerush';
// The game's name, in one place. The wall mural stacks the two words; the rest use the full name.
export const NAME = ['QUICKTIME', 'RUSH'];
export const TITLE = 'Quicktime Rush';

// Feedback goes to a Google Form owned by the game's author (responses land in its Responses tab / linked sheet).
// To point it somewhere else: make a form with one paragraph question, publish it, and put its formResponse
// address and the question's entry id here.
export const FEEDBACK = {
  url: 'https://docs.google.com/forms/d/e/1FAIpQLSd1E63d1li5xLOB2dzbdANftktJrbXzY46iYyz048lNJ0Qdsg/formResponse',
  field: 'entry.842792240',
};
