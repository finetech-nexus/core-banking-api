require('dotenv').config();
const axios = require('axios');
const qs = require('qs');

const FINERACT_URL = process.env.FINERACT_URL;
const USERNAME = process.env.FINERACT_USERNAME;
const PASSWORD = process.env.FINERACT_PASSWORD;

// Basic auth header
const auth = {
    username: USERNAME,
    password: PASSWORD
};

// 1. Create a client (after KYC approval)
async function createClient(user) {
    try {
        const response = await axios.post(
            `${FINERACT_URL}/clients`,
            {
                firstname: user.firstName,
                lastname: user.lastName,
                dateOfBirth: user.dob,       // format YYYY-MM-DD
                mobileNo: user.phone,
                active: true,
                activationDate: new Date().toISOString().split('T')[0]
            },
            { auth }
        );
        console.log('Client created:', response.data);
        return response.data.resourceId; // clientId
    } catch (error) {
        console.error('Error creating client:', error.response?.data || error.message);
        throw error;
    }
}

// 2. Create a savings account for the client
async function createSavingsAccount(clientId, productId) {
    try {
        const response = await axios.post(
            `${FINERACT_URL}/savingsaccounts`,
            {
                clientId,
                productId,                 // ID of the savings product in Fineract
                submittedOnDate: new Date().toISOString().split('T')[0],
                savingsProductId: productId,
                status: 'submitted'         // or 'approved' if auto-approved
            },
            { auth }
        );
        console.log('Savings account created:', response.data);
        return response.data.resourceId; // accountId
    } catch (error) {
        console.error('Error creating savings account:', error.response?.data || error.message);
        throw error;
    }
}

// Example usage
(async () => {
    try {
        const user = {
            firstName: 'John',
            lastName: 'Doe',
            dob: '1990-01-01',
            phone: '+1234567890'
        };

        const savingsProductId = 1; // replace with your actual savings product ID

        // 1. Create client
        const clientId = await createClient(user);

        // 2. Create savings account
        const accountId = await createSavingsAccount(clientId, savingsProductId);

        console.log(`Successfully created client ${clientId} with account ${accountId}`);
    } catch (err) {
        console.error('Provisioning failed:', err.message);
    }
})();
