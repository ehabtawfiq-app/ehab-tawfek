require('dotenv').config();
const { createApp } = require('./app');

const { app, config } = createApp();
app.listen(config.PORT, () => {
  console.log(`🚀 Dorak API is running on http://localhost:${config.PORT}`);
  if (config.ADMIN_PASSWORD === 'Dorak@12345' || config.JWT_SECRET.length < 32 || /replace|change|secret/i.test(config.JWT_SECRET)) {
    console.warn('⚠️ إعدادات الدخول الافتراضية للاختبار فقط. غيّر ADMIN_PASSWORD وJWT_SECRET قبل النشر.');
  }
});
