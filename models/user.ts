/** User & household types — Goose On The Go v2 design */

export interface HouseholdUser {
  id: number;
  name: string;
  role: 'Owner' | 'Member';
  icon: string;
  access: string;
  active: boolean;
}

export const INITIAL_USERS: HouseholdUser[] = [
  { id: 1, name: 'Alex Rivera', role: 'Owner', icon: 'profile', access: 'Full access', active: true },
  { id: 2, name: 'Sam Rivera', role: 'Member', icon: 'profile', access: 'Most features', active: true },
];
