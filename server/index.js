require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件 - 主站点
app.use(express.static(path.join(__dirname, '../public')));

// API路由
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);

// 热力地图展示页
app.get('/heatmap', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/heatmap/index.html'));
});

// 后台管理
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

// 所有其他路由指向主站
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`主站点: http://localhost:${PORT}`);
  console.log(`热力地图: http://localhost:${PORT}/heatmap`);
  console.log(`后台管理: http://localhost:${PORT}/admin`);
});
