import type { AttackKind } from '../input/actions';

export type ActivityKind = 'practice' | 'challenge' | 'drill';
export type TargetMode = 'none' | 'body' | 'head' | 'alternate' | 'any';

export interface DrillStep {
  /** Accepted techniques for this step, or 'block' for a successful guard. */
  accept: (AttackKind | 'block')[];
  label: string;
}

export interface Activity {
  id: string;
  kind: ActivityKind;
  title: string;
  /** One-line instruction shown before and during the activity. */
  brief: string;
  /** Time limit in seconds (challenges); null = untimed. */
  seconds: number | null;
  /** Challenges: valid hits needed. Drills: clean repetitions needed. */
  goal: number;
  target: TargetMode;
  /** Partner behaviour. */
  partner: 'still' | 'moving' | 'attacking';
  steps?: DrillStep[];
  /** Max time between drill steps (s). */
  window?: number;
}

const KICKS: AttackKind[] = ['front', 'round', 'side', 'back', 'leadFront', 'leadRound', 'leadSide'];

/** Training programme. Ids are stable: progress and belt requirements reference them. */
export const ACTIVITIES: Activity[] = [
  {
    id: 'practice',
    kind: 'practice',
    title: 'Technique practice',
    brief: 'Free practice on a held target. Try every kick, lead and rear leg, punch, guard and stance switch.',
    seconds: null,
    goal: 0,
    target: 'any',
    partner: 'still',
  },
  {
    id: 'body10',
    kind: 'challenge',
    title: 'Body kick challenge',
    brief: 'Land 10 valid kicks on the trunk protector in 40 seconds.',
    seconds: 40,
    goal: 10,
    target: 'body',
    partner: 'still',
  },
  {
    id: 'head5',
    kind: 'challenge',
    title: 'Head kick challenge',
    brief: 'Land 5 valid head-height kicks in 40 seconds (hold E / Head).',
    seconds: 40,
    goal: 5,
    target: 'head',
    partner: 'still',
  },
  {
    id: 'alternate',
    kind: 'challenge',
    title: 'Alternating targets',
    brief: 'Hit the lit target — it switches between head and body after every hit. 8 hits in 45 seconds.',
    seconds: 45,
    goal: 8,
    target: 'alternate',
    partner: 'still',
  },
  {
    id: 'moving',
    kind: 'challenge',
    title: 'Moving target',
    brief: 'Your partner circles and steps away. Land 6 valid kicks in 45 seconds.',
    seconds: 45,
    goal: 6,
    target: 'body',
    partner: 'moving',
  },
  {
    id: 'combo-front-round',
    kind: 'drill',
    title: 'Front kick → Roundhouse',
    brief: 'Land a front kick, then a rear roundhouse within 1.4 s. Three clean repetitions.',
    seconds: null,
    goal: 3,
    target: 'body',
    partner: 'still',
    window: 1.4,
    steps: [
      { accept: ['front', 'leadFront'], label: 'Front kick' },
      { accept: ['round'], label: 'Roundhouse' },
    ],
  },
  {
    id: 'combo-lead-rear',
    kind: 'drill',
    title: 'Lead roundhouse → Rear roundhouse',
    brief: 'Fast lead-leg roundhouse, then the rear-leg roundhouse within 1.4 s. Three repetitions.',
    seconds: null,
    goal: 3,
    target: 'body',
    partner: 'still',
    window: 1.4,
    steps: [
      { accept: ['leadRound'], label: 'Lead roundhouse' },
      { accept: ['round'], label: 'Rear roundhouse' },
    ],
  },
  {
    id: 'combo-side-back',
    kind: 'drill',
    title: 'Side kick → Back kick',
    brief: 'Side kick (either leg), then a spinning back kick within 1.6 s. Three repetitions.',
    seconds: null,
    goal: 3,
    target: 'body',
    partner: 'still',
    window: 1.6,
    steps: [
      { accept: ['side', 'leadSide'], label: 'Side kick' },
      { accept: ['back'], label: 'Back kick' },
    ],
  },
  {
    id: 'block-counter',
    kind: 'drill',
    title: 'Block → Counter',
    brief: 'Your partner attacks with front kicks. Guard to block, then counter with any kick within 1.4 s. Three repetitions.',
    seconds: null,
    goal: 3,
    target: 'body',
    partner: 'attacking',
    window: 1.4,
    steps: [
      { accept: ['block'], label: 'Block' },
      { accept: KICKS, label: 'Counter kick' },
    ],
  },
];

export const activityById = (id: string) => ACTIVITIES.find((a) => a.id === id) ?? ACTIVITIES[0];
