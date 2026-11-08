import { hashPassword } from '../domain/secrets';
import { dismissDuplicate } from '../services/duplicate-service';
import { createMember, markRead } from '../services/member-service';
import { mergeMembers } from '../services/merge-service';
import type { Deps, MemberSource, Role, Scope } from '../services/records';
import { isoDay } from '../services/records';

/**
 * Fictional demo data. Every name is invented and every email address uses the
 * reserved example.com domain. The roster is typed in through the same service
 * the API uses, and it contains deliberate duplicates of several kinds, one
 * pair that only looks like a duplicate, and one merge that is already done.
 */

export const DEMO_PASSWORD = 'trailhead-demo';

export const DEMO_USERS = {
  organizer: { name: 'Hollis Abara', email: 'hollis@example.com' },
  volunteer: { name: 'Petra Nowak', email: 'petra@example.com' },
  reader: { name: 'Jun Ito', email: 'jun@example.com' },
  otherOrganizer: { name: 'Maeve Okoro', email: 'maeve@example.com' },
} as const;

interface Person {
  first: string;
  last: string;
  email?: string;
  phone?: string;
  source?: MemberSource;
  notes?: string;
  /** Trip numbers (0 is the most recent trip) the person signed up for. */
  trips?: number[];
  /** Months ago that dues were paid, covering twelve months from then. */
  paid?: number;
}

const ROSTER: Person[] = [
  {
    first: 'Ada',
    last: 'Fenwick',
    email: 'ada.fenwick@example.com',
    phone: '07700 900101',
    trips: [0, 2, 3],
    paid: 2,
  },
  {
    first: 'Bao',
    last: 'Tran',
    email: 'bao.tran@example.com',
    phone: '07700 900102',
    trips: [1, 4],
    paid: 14,
  },
  { first: 'Carmen', last: 'Ortega', email: 'carmen@example.com', trips: [0, 1], paid: 5 },
  {
    first: 'Dmitri',
    last: 'Volkov',
    email: 'dmitri.volkov@example.com',
    phone: '07700 900104',
    trips: [2],
  },
  { first: 'Esme', last: 'Hartley', email: 'esme.hartley@example.com', source: 'event' },
  {
    first: 'Farid',
    last: 'Rahimi',
    email: 'farid@example.com',
    phone: '07700 900106',
    trips: [0, 3, 5],
    paid: 8,
  },
  { first: 'Greta', last: 'Lindqvist', email: 'greta.l@example.com', trips: [4], paid: 20 },
  { first: 'Hugo', last: 'Marchand', phone: '07700 900108', source: 'paper', trips: [1] },
  {
    first: 'Imani',
    last: 'Okafor',
    email: 'imani.okafor@example.com',
    phone: '07700 900109',
    trips: [0, 1, 2, 3],
    paid: 1,
  },
  { first: 'Jonas', last: 'Becker', email: 'jonas.becker@example.com', source: 'web' },
  {
    first: 'Keiko',
    last: 'Matsuda',
    email: 'keiko@example.com',
    phone: '07700 900111',
    trips: [2, 5],
    paid: 6,
  },
  { first: 'Leon', last: 'Whitlock', email: 'leon.whitlock@example.com', trips: [3] },
  {
    first: 'Mirela',
    last: 'Popescu',
    email: 'mirela@example.com',
    phone: '07700 900113',
    paid: 3,
    trips: [0],
  },
  {
    first: 'Nils',
    last: 'Aaltonen',
    email: 'nils.aaltonen@example.com',
    source: 'event',
    trips: [5],
  },
  {
    first: 'Oona',
    last: 'Byrne',
    email: 'oona.byrne@example.com',
    phone: '07700 900115',
    paid: 16,
  },
  { first: 'Pavel', last: 'Novotny', phone: '07700 900116', source: 'paper' },
  { first: 'Rosa', last: 'Delgado', email: 'rosa.delgado@example.com', trips: [1, 2], paid: 9 },
  {
    first: 'Stellan',
    last: 'Eriksen',
    email: 'stellan@example.com',
    phone: '07700 900118',
    trips: [4, 5],
    paid: 11,
  },
  { first: 'Tamsin', last: 'Hale', email: 'tamsin.hale@example.com', source: 'web' },
  {
    first: 'Umar',
    last: 'Siddiqui',
    email: 'umar@example.com',
    phone: '07700 900120',
    trips: [0, 2],
    paid: 4,
  },

  // Duplicates, each of a different kind.
  // 1. Same email in different capitals, typed in again from a paper sheet.
  {
    first: 'Zoë',
    last: 'Brandt',
    email: 'zoe.brandt@example.com',
    phone: '07700 900131',
    trips: [0, 1],
    paid: 7,
    notes: 'Leads the Thursday evening walks.',
  },
  {
    first: 'Zoe',
    last: 'Brandt',
    email: 'Zoe.Brandt@Example.com',
    source: 'paper',
    trips: [1, 3],
    notes: 'Has a first aid certificate.',
  },
  // 2. First and last name swapped on a sign-up sheet, same phone.
  {
    first: 'Katarzyna',
    last: 'Wolska',
    email: 'kasia.wolska@example.com',
    phone: '+44 7700 900132',
    trips: [2],
    paid: 10,
  },
  { first: 'Wolska', last: 'Katarzyna', phone: '07700 900132', source: 'paper', trips: [4] },
  // 3. A typing mistake in the name, same phone written differently.
  {
    first: 'Mattias',
    last: 'Engstrom',
    email: 'mattias@example.com',
    phone: '07700 900133',
    trips: [0, 5],
    paid: 13,
  },
  { first: 'Matias', last: 'Engström', phone: '(07700) 900-133', source: 'event', trips: [0] },
  // 4. Signed up twice on the web with the same email.
  { first: 'Priya', last: 'Raman', email: 'priya.raman@example.com', trips: [3] },
  {
    first: 'Priya',
    last: 'Raman',
    email: 'priya.raman@example.com',
    phone: '07700 900134',
    source: 'web',
  },

  // Not a duplicate: two different people in one household, sharing a phone.
  {
    first: 'Anna',
    last: 'Lindgren',
    email: 'anna.lindgren@example.com',
    phone: '07700 900140',
    trips: [1],
    paid: 2,
  },
  {
    first: 'Anne',
    last: 'Lindgren',
    email: 'anne.lindgren@example.com',
    phone: '07700 900140',
    trips: [2],
  },

  // Already merged in the seed, so the history page has an entry to undo.
  {
    first: 'Tobias',
    last: 'Reinholt',
    email: 'tobias@example.com',
    phone: '07700 900150',
    trips: [0, 4],
    paid: 5,
  },
  {
    first: 'Tobias',
    last: 'Reinholt',
    email: 'tobias@example.com',
    source: 'paper',
    trips: [4, 5],
    notes: 'Can drive the minibus.',
  },
];

const TRIPS = [
  'Saddleback ridge walk',
  'Coast path, eastern section',
  'Hollow beck waterfalls',
  'Winter skills day',
  'Three tarns round',
  'Midsummer night hike',
];

export async function isEmpty(deps: Deps): Promise<boolean> {
  const rows = await deps.db.admin.query<{ count: number }>(
    'select count(*)::int as count from users',
  );
  return (rows[0]?.count ?? 0) === 0;
}

export async function seedDemoData(deps: Deps): Promise<void> {
  const admin = deps.db.admin;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const today = deps.now();
  const daysAgo = (days: number): Date => new Date(today.getTime() - days * 86_400_000);

  const one = async (sql: string, params: unknown[]): Promise<string> => {
    const rows = await admin.query<{ id: string }>(sql, params);
    return rows[0]?.id ?? '';
  };
  const addUser = (user: { name: string; email: string }) =>
    one('insert into users (email, name, password_hash) values ($1, $2, $3) returning id', [
      user.email,
      user.name,
      passwordHash,
    ]);
  const addWorkspace = (name: string) =>
    one('insert into workspaces (name) values ($1) returning id', [name]);
  const join = async (workspaceId: string, userId: string, role: Role): Promise<Scope> => {
    await admin.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [
      workspaceId,
      userId,
      role,
    ]);
    return { workspaceId, userId, role };
  };

  const hollis = await addUser(DEMO_USERS.organizer);
  const petra = await addUser(DEMO_USERS.volunteer);
  const jun = await addUser(DEMO_USERS.reader);
  const maeve = await addUser(DEMO_USERS.otherOrganizer);

  const greywether = await addWorkspace('Greywether Hiking Club');
  const saltmarsh = await addWorkspace('Saltmarsh Ramblers');
  const organizer = await join(greywether, hollis, 'organizer');
  const volunteer = await join(greywether, petra, 'volunteer');
  await join(greywether, jun, 'reader');
  const otherOrganizer = await join(saltmarsh, maeve, 'organizer');
  await join(saltmarsh, hollis, 'reader');

  const tripIds: string[] = [];
  for (const [index, title] of TRIPS.entries()) {
    tripIds.push(
      await one(
        'insert into trips (workspace_id, title, happens_on) values ($1, $2, $3) returning id',
        [greywether, title, isoDay(daysAgo(20 + index * 45))],
      ),
    );
  }

  const ids: string[] = [];
  for (const [index, person] of ROSTER.entries()) {
    // Spread the records over the last three months, newest last, so that the
    // most recent few still count as new.
    const typedIn: Deps = { ...deps, now: () => daysAgo(96 - index * 3) };
    const member = await createMember(typedIn, index % 3 === 0 ? organizer : volunteer, {
      firstName: person.first,
      lastName: person.last,
      email: person.email,
      phone: person.phone,
      notes: person.notes ?? '',
      source: person.source ?? 'web',
    });
    ids.push(member.id);

    for (const trip of person.trips ?? []) {
      await admin.query(
        'insert into trip_signups (workspace_id, member_id, trip_id, attended) values ($1, $2, $3, $4)',
        [greywether, member.id, tripIds[trip], trip !== 0],
      );
    }
    if (person.paid !== undefined) {
      const paidOn = daysAgo(person.paid * 30);
      await admin.query(
        `insert into payments (workspace_id, member_id, amount_cents, paid_on, covers_until)
         values ($1, $2, 3000, $3, $4)`,
        [
          greywether,
          member.id,
          isoDay(paidOn),
          isoDay(new Date(paidOn.getTime() + 365 * 86_400_000)),
        ],
      );
    }
  }

  // The organizer has opened most records; the newest ones are still unread.
  for (const id of ids.slice(0, 22)) await markRead(deps, organizer, id);

  // One merge already done, so the history page shows an entry that can be undone.
  const [keptId, foldedId] = [ids.at(-2) ?? '', ids.at(-1) ?? ''];
  const earlier: Deps = { ...deps, now: () => daysAgo(2) };
  await mergeMembers(earlier, volunteer, {
    survivorId: keptId,
    absorbedId: foldedId,
    expectedSurvivorRevision: 1,
    expectedAbsorbedRevision: 1,
    firstName: 'survivor',
    lastName: 'survivor',
    email: 'survivor',
    phone: 'survivor',
    notes: 'both',
  });

  // The second club has its own roster, which the first must never see.
  const elsewhere = await createMember(deps, otherOrganizer, {
    firstName: 'Ravi',
    lastName: 'Menon',
    email: 'ravi.menon@example.com',
    source: 'web',
  });
  const twin = await createMember(deps, otherOrganizer, {
    firstName: 'Ravi',
    lastName: 'Menon',
    email: 'r.menon@example.com',
    phone: '07700 900199',
    source: 'paper',
  });
  await dismissDuplicate(deps, otherOrganizer, elsewhere.id, twin.id);
}
