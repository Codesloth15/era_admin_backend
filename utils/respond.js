// Wraps a handler that returns the response body: sends it as JSON, or passes
// a thrown error to the error middleware.
export const respond = handler => async (req, res, next) => {
  try {
    // Express 5 leaves req.body undefined when no JSON body is sent. Services validate
    // the fields themselves, so an empty object gets the same 400 messages as missing fields.
    req.body ??= {};
    res.json(await handler(req));
  } catch (error) {
    next(error);
  }
};
