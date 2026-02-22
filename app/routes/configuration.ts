import { Router, Request, Response, response } from "express";


export const route = Router();
/**
* @swagger
* tags:
*   name: Configuration
*   description: Configuration Client Mobile
*/

route.post(
  "/",
  async (request: Request, response: Response) => {
        //Load Data from .env (configMap)
      const data = { waiting_post_registraion : 60, 
                     link_into : '',
                     default_language :'',
                     inactivity_delai : 6,
                     contability_check : 'v1.0.0'
                     ///Other config App
                    }

      return response.status(200).json(data)
  }
);