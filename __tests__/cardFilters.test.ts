import { describe, it, expect } from '@jest/globals';
import { Card } from '../src/types/Types';
import { BANK_DICTIONARY, CARD_NETWORKS } from '../src/constants/Constants';
import { detectCardNetwork } from '../src/util/Utils';

describe('Card Filters Logic', () => {
  const getCardEffectiveNetwork = (card: Card): string => {
    if (card.network) return card.network.toUpperCase();
    const detected = detectCardNetwork(card.number, card.name);
    if (detected) return detected.toUpperCase();
    return '';
  };

  const mockCards: Card[] = [
    {
      key: '1',
      name: 'Regalia Gold',
      ownerName: 'Yash Mehta',
      bankName: 'HD',
      number: '4234567812345678', // starts with 4 -> VISA
      month: '12',
      year: '28',
      cvv: '123',
      limit: '500000',
      email: 'yash@example.com',
      cardType: 'CREDIT',
      network: 'VISA',
      isPersonal: true,
    },
    {
      key: '2',
      name: 'Millennia Debit',
      ownerName: 'Yash Mehta',
      bankName: 'HD',
      number: '5234567823456789', // starts with 52 -> MASTERCARD
      month: '05',
      year: '27',
      cvv: '456',
      limit: '',
      email: 'yash@example.com',
      cardType: 'DEBIT',
      network: 'MASTERCARD',
      isPersonal: true,
    },
    {
      key: '3',
      name: 'Coral Credit Card',
      ownerName: 'Alice Smith',
      bankName: 'IC',
      number: '6081234534567890', // starts with 60 -> RUPAY
      month: '08',
      year: '26',
      cvv: '789',
      limit: '200000',
      email: 'alice@example.com',
      cardType: 'CREDIT',
      network: 'RUPAY',
      isPersonal: true,
    },
    {
      key: '4',
      name: 'SimplyCLICK',
      ownerName: 'Bob Jones ',
      bankName: 'SB',
      number: '345678901456789', // starts with 34 -> AMEX
      month: '10',
      year: '29',
      cvv: '321',
      limit: '150000',
      email: 'bob@example.com',
      cardType: 'CREDIT',
      network: 'AMEX',
      isPersonal: true,
    },
    {
      key: '5',
      name: 'Meal Card',
      ownerName: 'Bob Jones',
      bankName: 'PX',
      number: '6011567890125678', // starts with 6011 -> DISCOVER / RUPAY
      month: '11',
      year: '25',
      cvv: '654',
      limit: '',
      email: 'bob@example.com',
      cardType: 'PREPAID',
      network: 'RUPAY',
      isPersonal: true,
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

  it('gathers unique payment networks sorted alphabetically', () => {
    const netSet = new Set<string>();
    mockCards.forEach((c) => {
      const net = getCardEffectiveNetwork(c);
      if (net) {
        netSet.add(net);
      }
    });
    const availableNetworks = Array.from(netSet).sort((a, b) => {
      const nameA = CARD_NETWORKS[a] || a;
      const nameB = CARD_NETWORKS[b] || b;
      return nameA.localeCompare(nameB);
    });

    expect(availableNetworks).toEqual(['AMEX', 'MASTERCARD', 'RUPAY', 'VISA']);
    expect(availableNetworks.map(k => CARD_NETWORKS[k])).toEqual([
      'American Express',
      'Mastercard',
      'RuPay',
      'Visa',
    ]);
  });

  it('filters cards by single selected bank', () => {
    const selectedBank = 'HD';
    const filtered = mockCards.filter((card) => card.bankName === selectedBank);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.name)).toEqual(['Regalia Gold', 'Millennia Debit']);
  });

  it('filters cards by single selected payment network', () => {
    const selectedNetwork = 'RUPAY';
    const filtered = mockCards.filter(
      (card) => getCardEffectiveNetwork(card) === selectedNetwork,
    );

    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.name)).toEqual(['Coral Credit Card', 'Meal Card']);
  });

  it('filters cards by single selected cardholder name', () => {
    const selectedName = 'Bob Jones';
    const filtered = mockCards.filter(
      (card) => (card.ownerName || '').trim().toLowerCase() === selectedName.trim().toLowerCase(),
    );

    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.key)).toEqual(['4', '5']);
  });

  it('filters cards combining type, bank, network, and name filters', () => {
    const typeFilter: string = 'CREDIT';
    const bankFilter = 'HD';
    const networkFilter = 'VISA';
    const nameFilter = 'Yash Mehta';

    const filtered = mockCards.filter((card) => {
      if (typeFilter !== 'ALL' && card.cardType !== typeFilter) return false;
      if (bankFilter && card.bankName !== bankFilter) return false;
      if (networkFilter && getCardEffectiveNetwork(card) !== networkFilter) return false;
      if (nameFilter && (card.ownerName || '').trim().toLowerCase() !== nameFilter.trim().toLowerCase()) {
        return false;
      }
      return true;
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Regalia Gold');
  });

  it('clearing filters returns all cards', () => {
    const typeFilter: string = 'ALL';
    const bankFilter = null;
    const networkFilter = null;
    const nameFilter = null;

    const filtered = mockCards.filter((card) => {
      if (typeFilter !== 'ALL' && card.cardType !== typeFilter) return false;
      if (bankFilter && card.bankName !== bankFilter) return false;
      if (networkFilter && getCardEffectiveNetwork(card) !== networkFilter) return false;
      if (nameFilter && (card.ownerName || '').trim().toLowerCase() !== (nameFilter as string).trim().toLowerCase()) {
        return false;
      }
      return true;
    });

    expect(filtered).toHaveLength(mockCards.length);
  });
});
