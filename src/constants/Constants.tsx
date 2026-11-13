import { BankDictionary } from "../types/Types";

export const WEB_CLIENT_ID: string = '566381520762-men69odgck2o91alaa6fm6stubjpr1ng.apps.googleusercontent.com';

// Create the dictionary constant
export const BANK_DICTIONARY: BankDictionary = {
    HD: "HDFC",
    IC: "ICICI",
    AX: "Axis",
    AM: "American Express",
    DC: "Diners Club",
    HS: "HSBC",
    KT: "Kotak",
    ID: "IDFC",
    SB: "SBI",
    FD: "Federal",
    SW: "Saraswat",
    IN: "IndusInd",
    CT: "Citi",
    RL: "RBL",
    BB: "Bank of Baroda",
    AU: "AU Small Finance",
    PN: "PNB (Punjab National)",
    CN: "Canara",
    UN: "Union",
    YS: "Yes",
    SC: "Standard Chartered",
    DB: "DBS",
    BO: "Bank of India",
    IB: "Indian",
    CB: "Central",
    IDB: "IDBI",
    BD: "Bandhan",
    KV: "Karur Vysya",
    SI: "South Indian",
    UB: "UCO",
    IO: "Indian Overseas",
    PS: "Punjab & Sind",
    JK: "J&K",
    OT: "Other",
};

export const BANK_COLORS: BankDictionary = {
    HD: "#0033A0", // HDFC - Dark Blue
    IC: "#FF4F00", // ICICI - Orange
    AX: "#E40046", // Axis - Red
    AM: "#006FCF", // American Express - Iconic Amex Blue
    DC: "#0079BE", // Diners Club - Cyan/Blue
    HS: "#8A8D8F", // HSBC - Grey
    KT: "#E2003F", // Kotak - Red
    ID: "#902A2C", // IDFC - Dark Red
    SB: "#0064A2", // SBI - Blue
    FD: "#0066CC", // Federal - Blue
    SW: "#D17F23", // Saraswat - Orange
    IN: "#832625", // IndusInd - Dark Red
    CT: "#003B5C", // Citi - Blue
    RL: "#9E1B32", // RBL - Dark Red
    BB: "#FF6A00", // Bank of Baroda - Orange
    AU: "#6A1B9A", // AU Small Finance - Purple
    PN: "#A21D3C", // PNB - Maroon
    CN: "#0082C9", // Canara - Sky Blue
    UN: "#D8232A", // Union - Red
    YS: "#00478F", // Yes - Blue
    SC: "#008A00", // Standard Chartered - Green
    DB: "#E61C24", // DBS - Red
    BO: "#F26522", // Bank of India - Orange
    IB: "#0B2545", // Indian - Navy Blue
    CB: "#003D7A", // Central - Blue
    IDB: "#006837", // IDBI - Green
    BD: "#003366", // Bandhan - Dark Blue
    KV: "#990000", // Karur Vysya - Maroon
    SI: "#C41230", // South Indian - Red
    UB: "#154889", // UCO - Blue
    IO: "#003366", // Indian Overseas - Navy
    PS: "#D71920", // Punjab & Sind - Red
    JK: "#1A365D", // J&K - Deep Blue
    OT: "#2D3748", // Other - Slate Grey
};

export const CARD_NETWORKS: { [key: string]: string } = {
    VISA: "Visa",
    MASTERCARD: "Mastercard",
    AMEX: "American Express",
    RUPAY: "RuPay",
    DINERS: "Diners Club",
    DISCOVER: "Discover",
};

export const CARD_TYPES: { [key: string]: string } = {
    CREDIT: "Credit",
    DEBIT: "Debit",
};


export const ENV: string = 'production'; //'production' Or 'testing';

