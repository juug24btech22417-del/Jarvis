function findNewText(oldStr, newStr) {
    if (!oldStr) return newStr;
    if (oldStr === newStr) return "";
    
    // If newStr simply extends oldStr
    if (newStr.startsWith(oldStr)) {
        return newStr.substring(oldStr.length).trim();
    }
    
    // If newStr contains oldStr fully (e.g. some prefix was added, very rare for captions but possible)
    if (newStr.includes(oldStr)) {
        return newStr.substring(newStr.indexOf(oldStr) + oldStr.length).trim();
    }
    
    // Check for overlapping suffix of oldStr and prefix of newStr
    // We check from the largest possible overlap down to 1
    const minLen = Math.min(oldStr.length, newStr.length);
    for (let i = minLen; i >= 1; i--) {
        const suffix = oldStr.substring(oldStr.length - i);
        const prefix = newStr.substring(0, i);
        if (suffix === prefix) {
            return newStr.substring(i).trim();
        }
    }
    
    // If no overlap, the entire string is new (e.g. captions cleared and restarted)
    return newStr.trim();
}

console.log(findNewText("Hello", "Hello world")); // "world"
console.log(findNewText("Hello world", "world how are you")); // "how are you"
console.log(findNewText("Hello world", "Hello world")); // ""
console.log(findNewText("Test", "Completely new")); // "Completely new"
console.log(findNewText("Speaker: Hello", "Speaker: Hello world")); // "world"

