import type { Request, Response, NextFunction } from 'express';

export interface CorsOptions {
  allowedOrigins?: string[] | '*';
  allowedMethods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  allowCredentials?: boolean;
  maxAge?: number;
}

const defaultOptions: CorsOptions = {
  allowedOrigins: '*',
  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Disposition', 'X-Document-SHA256', 'X-Document-Status'],
  allowCredentials: true,
  maxAge: 86400,
};

export function cors(options: CorsOptions = defaultOptions) {
  const {
    allowedOrigins = '*',
    allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders = ['Authorization', 'Content-Type', 'X-Requested-With', 'Accept'],
    exposedHeaders = ['Content-Disposition', 'X-Document-SHA256', 'X-Document-Status'],
    allowCredentials = true,
    maxAge = 86400,
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    if (allowedOrigins === '*') {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    } else if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    if (allowCredentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    res.setHeader('Access-Control-Allow-Methods', allowedMethods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));
    res.setHeader('Access-Control-Expose-Headers', exposedHeaders.join(', '));
    res.setHeader('Access-Control-Max-Age', maxAge.toString());

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}
