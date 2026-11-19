export const formatCardNumber = (number: string): string => {
    const clean = number.replace(/\D/g, '');

    // Diners Club (14 digits, typically starts with 300-305, 3095, 36, 38, 39): formatted as 4-6-4
    if (/^(30[0-5]|3095|36|38|39)/.test(clean)) {
        const trimmed = clean.substring(0, 14);
        const part1 = trimmed.substring(0, 4);
        const part2 = trimmed.substring(4, 10);
        const part3 = trimmed.substring(10, 14);
        if (part3) return `${part1} ${part2} ${part3}`;
        if (part2) return `${part1} ${part2}`;
        return part1;
    }

    // American Express (15 digits, starts with 34 or 37): formatted as 4-6-5
    if (/^(34|37)/.test(clean)) {
        const trimmed = clean.substring(0, 15);
        const part1 = trimmed.substring(0, 4);
        const part2 = trimmed.substring(4, 10);
        const part3 = trimmed.substring(10, 15);
        if (part3) return `${part1} ${part2} ${part3}`;
        if (part2) return `${part1} ${part2}`;
        return part1;
    }

    // Standard cards (16 digits): formatted as 4-4-4-4
    return clean
        .substring(0, 16)
        .replace(/(\d{4})(?=\d)/g, '$1 ')
        .trim();
};

export const maskCardNumber = (number: string): string => {
    if (!number) return '••••';
    const clean = number.replace(/\D/g, '');
    if (clean.length <= 4) return clean;
    const last4 = clean.slice(-4);

    // Diners (14 digits: 4-6-4)
    if (/^(30[0-5]|3095|36|38|39)/.test(clean) || clean.length === 14) {
        return `•••• •••••• ${last4}`;
    }

    // Amex (15 digits: 4-6-5)
    if (/^(34|37)/.test(clean) || clean.length === 15) {
        return `•••• •••••• •${last4}`;
    }

    // Standard cards (16 digits: 4-4-4-4)
    return `•••• •••• •••• ${last4}`;
};

export const removeSpaceFromString = (inputString: string): string => {
    return inputString.replace(/\s+/g, '');
}

export const detectCardNetwork = (pan: string, label: string = ''): string => {
    const upperLabel = label.toUpperCase();
    if (upperLabel.includes('DINERS')) return 'DINERS';
    if (upperLabel.includes('AMEX') || upperLabel.includes('AMERICAN EXPRESS')) return 'AMEX';
    if (upperLabel.includes('RUPAY')) return 'RUPAY';
    if (upperLabel.includes('MASTERCARD') || upperLabel.includes('MASTER CARD')) return 'MASTERCARD';
    if (upperLabel.includes('DISCOVER')) return 'DISCOVER';
    if (upperLabel.includes('VISA')) return 'VISA';

    const clean = pan.replace(/\D/g, '');
    if (/^(30[0-5]|3095|36|38|39)/.test(clean)) return 'DINERS';
    if (/^(34|37)/.test(clean)) return 'AMEX';
    if (clean.startsWith('4')) return 'VISA';
    if (/^(5[1-5]|2[2-7])/.test(clean)) return 'MASTERCARD';
    if (/^(60|65|81|82|508)/.test(clean)) return 'RUPAY';
    if (/^(6011|644|645)/.test(clean)) return 'DISCOVER';

    return '';
};

export const detectCardType = (label: string = ''): string => {
    const upperLabel = label.toUpperCase();
    if (upperLabel.includes('PREPAID') || upperLabel.includes('BENEFIT') || upperLabel.includes('MEAL')) return 'PREPAID';
    if (upperLabel.includes('DEBIT')) return 'DEBIT';
    if (upperLabel.includes('CREDIT')) return 'CREDIT';
    return '';
};

export const convertLongNumberToText = (num: number) => {
    if (num >= 10000000) {
        return `${(num / 10000000).toFixed(2)} CR`;
    } else if (num >= 100000) {
        return `${(num / 100000).toFixed(2)} L`;
    } else if (num >= 1000) {
        return `${(num / 1000).toFixed(1)} K`;
    } else {
        return `${num} RS`;
    }
};

import { toTimestampMillis } from '../services/sharingUtils';

export const formatCardLimit = (limitValue: string | number): string => {
    const clean = typeof limitValue === 'string' ? limitValue.replace(/\D/g, '') : limitValue;
    const num = Number(clean);
    if (!num || isNaN(num) || num <= 0) return '';
    if (num >= 10000000) {
        const val = Number((num / 10000000).toFixed(2));
        return `${val}Cr`;
    } else if (num >= 100000) {
        const val = Number((num / 100000).toFixed(2));
        return `${val}L`;
    } else if (num >= 1000) {
        const val = Number((num / 1000).toFixed(1));
        return `${val}K`;
    }
    return `${num}`;
};

export const formatBillGenerationDate = (val?: string | number): string => {
    if (!val) return '';
    const str = String(val).trim();
    if (!str) return '';
    const num = parseInt(str, 10);
    if (!isNaN(num) && num >= 1 && num <= 31) {
        const j = num % 10;
        const k = num % 100;
        let suffix = 'th';
        if (j === 1 && k !== 11) suffix = 'st';
        else if (j === 2 && k !== 12) suffix = 'nd';
        else if (j === 3 && k !== 13) suffix = 'rd';
        return `${num}${suffix}`;
    }
    return str;
};

export const formatCardUpdatedDate = (val?: any): string => {
    const ms = toTimestampMillis(val);
    if (!ms) return '';
    const date = new Date(ms);
    const now = new Date();
    const day = date.getDate();
    const month = date.toLocaleString('en-US', { month: 'short' });
    if (date.getFullYear() === now.getFullYear()) {
        return `${day} ${month}`;
    }
    return `${day} ${month} '${String(date.getFullYear()).slice(-2)}`;
};
