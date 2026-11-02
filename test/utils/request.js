const request = require('supertest');

const app = require('../../app');
const {getTokenHeaderName} = require('../../utils/getTokenHeaderUtils');

const tokenVariable = getTokenHeaderName();

function extractTokenFromCookies({cookies}) {
  if (!cookies) return null;

  const tokenCookie = cookies.find((cookie) =>
    cookie.startsWith(`${tokenVariable}=`)
  );

  return tokenCookie ? tokenCookie.split('=')[1].split(';')[0] : null;
}

const postRequest = async ({requestUrl, payload = {}, token}) => {
  const response = await request(app)
    .post(`${requestUrl}`)
    .send(payload)
    .set('Cookie', `${tokenVariable}=${token}`);

  response.responseToken = extractTokenFromCookies({
    cookies: response.get('set-cookie'),
  });

  return response;
};

const getRequest = async ({requestUrl, token}) => {
  const response = await request(app)
    .get(`${requestUrl}`)
    .set('Cookie', `${tokenVariable}=${token}`);

  response.responseToken = extractTokenFromCookies({
    cookies: response.get('set-cookie'),
  });

  return response;
};

const putRequest = async ({requestUrl, payload = {}, token}) => {
  const response = await request(app)
    .put(`${requestUrl}`)
    .send(payload)
    .set('Cookie', `${tokenVariable}=${token}`);

  response.responseToken = extractTokenFromCookies({
    cookies: response.get('set-cookie'),
  });

  return response;
};

const patchRequest = async ({requestUrl, payload = {}, token}) => {
  const response = await request(app)
    .patch(`${requestUrl}`)
    .send(payload)
    .set('Cookie', `${tokenVariable}=${token}`);

  response.responseToken = extractTokenFromCookies({
    cookies: response.get('set-cookie'),
  });

  return response;
};

const deleteRequest = async ({requestUrl, token}) => {
  const response = await request(app)
    .delete(`${requestUrl}`)
    .set('Cookie', `${tokenVariable}=${token}`);

  response.responseToken = extractTokenFromCookies({
    cookies: response.get('set-cookie'),
  });

  return response;
};

module.exports = {
  postRequest,
  getRequest,
  putRequest,
  patchRequest,
  deleteRequest,
};
