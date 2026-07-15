// Vocabulary for the leadership-profile questions collected during
// onboarding (Onboarding.jsx), beyond name/age/interests — signal for a
// future quest-recommendation step to match quests to where someone
// actually is in their leadership journey, not just their interest tags.
// Each `value` is what's stored on users/{uid} and validated server-side
// (see submit_onboarding in functions/main.py); `label` is what's shown.
export const EXPERIENCE_LEVELS = [
  { value: 'new', label: "New to this — I haven't really led before" },
  { value: 'some', label: "Some experience — I've led a group or project a few times" },
  { value: 'experienced', label: 'Experienced — I regularly take the lead' },
];

export const TIME_AVAILABILITY = [
  { value: 'monthly', label: 'A few hours a month' },
  { value: 'weekly', label: 'A few hours a week' },
  { value: 'flexible', label: 'As much as I can, whenever it fits' },
];

export const GROUP_PREFERENCES = [
  { value: 'solo', label: "Solo — I'd rather work independently" },
  { value: 'team', label: 'Small team — a few people working together' },
  { value: 'leading', label: 'Leading — organizing or guiding a group' },
];

export const MOTIVATIONS = [
  { value: 'experience', label: 'Build real-world experience and skills' },
  { value: 'community', label: 'Meet people and be part of a community' },
  { value: 'impact', label: 'Give back and make an impact' },
  { value: 'requirement', label: 'Required for school or work' },
];

// The closing question's presets — unlike the four above, there's no short
// slug worth inventing here (it's read as prose, by a person or a future
// LLM, either way), so value and label are the same string. ChoiceField
// appends "Other" itself (see Onboarding.jsx) for anyone whose answer isn't
// one of these.
export const LEADER_GOAL_OPTIONS = [
  'An organizer people can count on to get things done',
  'A motivator who gets others excited to show up',
  'A calm problem-solver in tough moments',
  'A connector who brings people together',
];
