import { Card } from '../src/types/Types';
import { BANK_DICTIONARY } from '../src/constants/Constants';

describe('Card Filters Logic', () => {
  const mockCards: Card[] = [
    {
      key: '1',
      name: 'Regalia Gold',
      ownerName: 'Yash Mehta',
      bankName: 'HD',
      number: '1234567812345678',
      month: '12',
      year: '28',
      cvv: '123',
      limit: '500000',
      email: 'yash@example.com',
      cardType: 'CREDIT',
    },
    {
      key: '2',
      name: 'Millennia Debit',
      ownerName: 'Yash Mehta',
      bankName: 'HD',
      number: '2345678923456789',
      month: '05',
      year: '27',
      cvv: '456',
      limit: '',
      email: 'yash@example.com',
      cardType: 'DEBIT',
    },
    {
      key: '3',
      name: 'Coral Credit Card',
      ownerName: 'Alice Smith',
      bankName: 'IC',
      number: '3456789034567890',
      month: '08',
      year: '26',
      cvv: '789',
      limit: '200000',
      email: 'alice@example.com',
      cardType: 'CREDIT',
    },
    {
      key: '4',
      name: 'SimplyCLICK',
      ownerName: 'Bob Jones ',
      bankName: 'SB',
      number: '4567890145678901',
      month: '10',
      year: '29',
      cvv: '321',
      limit: '150000',
      email: 'bob@example.com',
      cardType: 'CREDIT',
    },
    {
      key: '5',
      name: 'Meal Card',
      ownerName: 'Bob Jones',
      bankName: 'PX',
      number: '5678901256789012',
      month: '11',
      year: '25',
      cvv: '654',
      limit: '',
      email: 'bob@example.com',
      cardType: 'PREPAID',
    },
  ];

  it('gathers unique banks sorted alphabetically', () => {
    const bankSet = new Set<string>();
    mockCards.forEach((c) => {
      if (c.bankName) {
        bankSet.add(c.bankName);
      }
    });
    const availableBanks = Array.from(bankSet).sort((a, b) => {
      const nameA = BANK_DICTIONARY[a] || a;
      const nameB = BANK_DICTIONARY[b] || b;
      return nameA.localeCompare(nameB);
    });

    expect(availableBanks).toEqual(['HD', 'IC', 'PX', 'SB']);
    expect(availableBanks.map(k => BANK_DICTIONARY[k])).toEqual([
      'HDFC',
      'ICICI',
      'Pluxee',
      'SBI',
    ]);
  });

  it('gathers unique cardholder names sorted alphabetically and trimmed', () => {
    const nameSet = new Set<string>();
    mockCards.forEach((c) => {
      const trimmed = c.ownerName ? c.ownerName.trim() : '';
      if (trimmed) {
        nameSet.add(trimmed);
      }
    });
    const availableNames = Array.from(nameSet).sort((a, b) => a.localeCompare(b));

    expect(availableNames).toEqual(['Alice Smith', 'Bob Jones', 'Yash Mehta']);
  });

  it('filters cards by single selected bank', () => {
    const selectedBank = 'HD';
    const filtered = mockCards.filter((card) => card.bankName === selectedBank);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.name)).toEqual(['Regalia Gold', 'Millennia Debit']);
  });

  it('filters cards by single selected cardholder name', () => {
    const selectedName = 'Bob Jones';
    const filtered = mockCards.filter(
      (card) => (card.ownerName || '').trim().toLowerCase() === selectedName.trim().toLowerCase(),
    );

    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.key)).toEqual(['4', '5']);
  });

  it('filters cards combining type, bank, and name filters', () => {
    const typeFilter = 'CREDIT';
    const bankFilter = 'HD';
    const nameFilter = 'Yash Mehta';

    const filtered = mockCards.filter((card) => {
      if (typeFilter !== 'ALL' && card.cardType !== typeFilter) return false;
      if (bankFilter && card.bankName !== bankFilter) return false;
      if (nameFilter && (card.ownerName || '').trim().toLowerCase() !== nameFilter.trim().toLowerCase()) {
        return false;
      }
      return true;
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Regalia Gold');
  });

  it('clearing bank or name filter returns all matching cards', () => {
    const typeFilter = 'ALL';
    const bankFilter = null;
    const nameFilter = null;

    const filtered = mockCards.filter((card) => {
      if (typeFilter !== 'ALL' && card.cardType !== typeFilter) return false;
      if (bankFilter && card.bankName !== bankFilter) return false;
      if (nameFilter && (card.ownerName || '').trim().toLowerCase() !== (nameFilter as string).trim().toLowerCase()) {
        return false;
      }
      return true;
    });

    expect(filtered).toHaveLength(mockCards.length);
  });
});
