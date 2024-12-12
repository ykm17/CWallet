export const formatCardNumber = (number: string): string => {
    return number
        .replace(/\s?/g, '') // Remove existing spaces
        .replace(/(\d{4})/g, '$1 ') // Add space after every 4 digits
        .trim(); // Trim any trailing spaces
};


export const removeSpaceFromString = (inputString: string): string => {
    return inputString.replace(/\s+/g, '');
}

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
}
