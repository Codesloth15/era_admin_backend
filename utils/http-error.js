// An error with an HTTP status. The error middleware returns its message to the client;
// any other error is logged and answered with a generic 500.
export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
    this.statusCode = status;
  }
}

export const fail = (message, status = 400) => { throw new HttpError(status, message); };
