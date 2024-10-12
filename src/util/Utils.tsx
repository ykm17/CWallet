export const formatCardNumber = (number: string): string => {
    return number
        .replace(/\s?/g, '') // Remove existing spaces
        .replace(/(\d{4})/g, '$1 ') // Add space after every 4 digits
        .trim(); // Trim any trailing spaces
};


export const removeSpaceFromString = (inputString: string): string => {
    return inputString.replace(/\s+/g, '');
}
