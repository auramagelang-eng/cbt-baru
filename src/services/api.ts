import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cbt_auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only clear credentials if an explicit auth check failed, NOT on general background polling
    const requestUrl = error.config?.url || '';
    const isAuthEndpoint = requestUrl.includes('/auth/');
    if (error.response?.status === 401 && isAuthEndpoint) {
      localStorage.removeItem('cbt_auth_token');
      localStorage.removeItem('cbt_user');
      localStorage.removeItem('cbt_active_exam');
    }
    return Promise.reject(error);
  }
);
