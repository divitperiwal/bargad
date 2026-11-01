import { FamilyRepository } from '#modules/families/family/family.repository';
import { FamilyService } from '#modules/families/family/family.service';
import { LedgerRepository } from '#modules/household/ledger/ledger.repository';
import { notFound, type Person } from './overview.helper';
import { OverviewRepository } from './overview.repository';
import { sumSubtotals, toSubtotal } from './valuation.util';

export const OverviewService = {
  get: async (viewerId: string) => {
    const membership = await FamilyService.findMembership(viewerId);
    const people: Person[] = membership
      ? await FamilyRepository.listActiveMembers(membership.familyId)
      : [
          {
            userId: viewerId,
            displayName: (await OverviewRepository.findUserName(viewerId)) ?? '',
            role: 'head',
            relationship: 'self',
          },
        ];
    const userIds = people.map((p) => p.userId);
    // The repositories already drop other members' hidden items, so every number below is what the viewer may know.
    const [accounts, entries] = await Promise.all([
      OverviewRepository.listAccountsForUsers(userIds, viewerId),
      LedgerRepository.listForUsers(userIds, viewerId),
    ]);
    const mayInspect = (userId: string) => userId === viewerId || !membership || membership.role === 'head';

    const members = people.map(({ userId, displayName, role, relationship }) => ({
      member: { userId, displayName, role, relationship, visible: mayInspect(userId) },
      subtotal: toSubtotal({
        accounts: accounts.filter((a) => a.userId === userId),
        entries: entries.filter((e) => e.userId === userId),
      }),
    }));

    return {
      scope: membership ? ('family' as const) : ('solo' as const),
      totals: sumSubtotals(members.map((m) => m.subtotal)),
      members: members.map(({ member, subtotal }) => (member.visible ? { ...member, subtotal } : member)),
    };
  },

  member: async (viewerId: string, userId: string) => {
    if (userId !== viewerId) {
      const membership = await FamilyService.findMembership(viewerId);
      const isHeadOfThem =
        membership?.role === 'head' && !!(await FamilyRepository.findActiveMember(membership.familyId, userId));
      if (!isHeadOfThem) throw notFound();
    }
    const displayName = await OverviewRepository.findUserName(userId);
    if (displayName === undefined) throw notFound();

    const accounts = await OverviewRepository.listAccountsForUsers([userId], viewerId);
    const holdings = accounts.length > 0 ? await OverviewRepository.listHoldings(accounts.map((a) => a.id)) : [];
    const entries = await LedgerRepository.listForUsers([userId], viewerId);

    return {
      member: { userId, displayName },
      accounts: accounts.map(({ userId: _owner, ...account }) => ({
        ...account,
        holdings: holdings
          .filter((h) => h.brokerAccountId === account.id)
          .map(({ brokerAccountId: _account, ...holding }) => holding),
      })),
      ledgerEntries: entries.map(({ userId: _owner, ...entry }) => entry),
    };
  },
};
