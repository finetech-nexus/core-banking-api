import { body } from "express-validator";

const registerValidator = [
  body("phone_number")
    .not()
    .isEmpty()
    .withMessage("phone_number is required")
    .custom(async (value) => {
      // Check if a user with the same username already exists
      const user = null //TODO: await prisma.user.findFirst({ where: { username: value } });
      if (user) {
        throw new Error("phone_number already exists");
      }
      return true;
    }),
  body("email", "Email is required")
    .isEmail()
    .custom(async (value) => {
      // Check if a user with the same email already exists
      const user = null; //TODO: await prisma.user.findFirst({ where: { email: value } });
      if (user) {
        throw new Error("Email already exists");
      }
      return true;
    }),
  body("first_name")
    .not()
    .isEmpty()
    .withMessage("first_name is required")
    .isLength({ min:3, max: 16 })
    .withMessage("first_name is must be minimum 3 character"),
  body("last_name")
        .not()
        .isEmpty()
        .withMessage("last_name is required")
        .isLength({ min:3, max: 16 })
        .withMessage("last_name is must be minimum 3 character"),
];


const verifyOtpPhoneValidator = [
  body("phone_number")
    .notEmpty()
    .withMessage("phone_number is required")
    .isMobilePhone("any")
    .withMessage("Invalid phone_number format"),

  body("otp")
    .optional()
    .isLength({ min: 4, max: 6 })
    .withMessage("otp must be between 4 and 6 digits")
    .matches(/^[0-9]+$/)
    .withMessage("otp must contain only numbers"),
];



const verifyOtpEmailValidator = [
  body("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email format")
    .custom(async (value) => {
      // TODO: check if email already exists in your DB or Keycloak
      const user = null; // await prisma.user.findFirst({ where: { email: value } });
      if (user) {
        throw new Error("Email already exists");
      }
      return true;
    }),
  body("otp")
    .optional()
    .isLength({ min: 4, max: 6 })
    .withMessage("otp must be between 4 and 6 digits")
    .matches(/^[0-9]+$/)
    .withMessage("otp must contain only numbers"),
];

const validators = { registerValidator, verifyOtpEmailValidator, verifyOtpPhoneValidator };
export default validators;