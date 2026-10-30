const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

console.log('Includes forgotPasswordCard:', html.includes('id="forgotPasswordCard"'));
console.log('Includes showForgotPasswordForm:', html.includes('function showForgotPasswordForm'));
console.log('Includes submitForgotPasswordReset:', html.includes('function submitForgotPasswordReset'));
console.log('Includes togglePasswordVisibility:', html.includes('function togglePasswordVisibility'));
console.log('Includes resetUserPassword in mutatingFunctions:', html.includes("'resetUserPassword'"));
