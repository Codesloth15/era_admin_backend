// Wraps a handler that returns the response body: sends it as JSON, or passes
// a thrown error to the error middleware.
export const respond = handler => async (req, res, next) => {
  try {
    res.json(await handler(req));
  } catch (error) {
    next(error);
  }
};
