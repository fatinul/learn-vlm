const path = require('path');
const express = require('express');
const pagesRouter = require('./routes/pages');
const apiRouter = require('./routes/api');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/chartjs', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist')));

app.use('/', pagesRouter);
app.use('/api', apiRouter);

module.exports = app;
