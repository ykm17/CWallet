export interface Card {
    ownerName: string,
    bankName: string,
    number: string,
    month: string,
    year: string,
    cvv: string,
    name: string,
    limit: string,
    key: string,
    isPersonal: boolean,
    email: string,
    network?: string,
    cardType?: string,
}

// Define the dictionary type
export type BankDictionary = {
    [key: string]: string;
};