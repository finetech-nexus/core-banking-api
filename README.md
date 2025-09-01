# Node.js backend

This repository provides an implementation of selfservice

## Prerequisites
Before running this application, ensure that you have the following prerequisites installed:

Docker 
Docker Compose 

## Installation
Clone the repository:

```bash
git clone 
```
Build and run the Docker containers:

```bash
cd your-repo
docker-compose up --build
```

Build and tag version:


```bash
docker build -t nexusbank/self-service-api .
docker tag nexusbank/self-service-api  nexusbank/self-service-api:latest    
docker login
docker push nexusbank/self-service-api:latest
```

## Access the application:

The application should now be running and accessible at http://localhost:3000.

## Configuration
The application's configuration can be adjusted using environment variables defined in the .env file located in the root of the project. The following variables are available:

```environment
# Fineract configuration
FINERACT_BASE_URL =  "https://corebanking.io";
FINERACT_TENANT = "default";
FINERACT_BASE_PATH =  "/fineract-provider/api/v1";

# Keycloak configuration
KEYCLOAK_URL=http://localhost:8080/auth
KEYCLOAK_REALM=your-realm
KEYCLOAK_CLIENT_ID=your-client-id
KEYCLOAK_CLIENT_SECRET=your-client-secret
```

## Usage

The application  offer api for keycloak auth and business api for selfService 
### 1. New User Registration
    ```
    1. Call register_self_service with user details
    2. User receives authentication token via email
    3. Call confirm_registration with request_id and token
    4. User can now login with credentials
    ```

### 2. View Account Information
    ```
    1. Call login_self_service to authenticate
    2. Call get_client_info to get client ID
    3. Call get_client_accounts with client ID
    4. Call get_client_transactions for transaction history
    ```

### 3. Setup and Make Transfer
    ```
    1. Login with credentials
    2. Call add_beneficiary to add recipient
    3. Call get_transfer_template for transfer options
    4. Call make_third_party_transfer with details
    ```

### 4. Manage Beneficiaries
    ```
    1. Login with credentials
    2. Call get_beneficiaries to list all
    3. Call update_beneficiary to modify limits
    4. Call delete_beneficiary to remove

## Contributing
Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request.

## License
This project is licensed under the






