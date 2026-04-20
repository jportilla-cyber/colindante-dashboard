const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html':'text/html','.css':'text/css','.js':'application/javascript',
  '.json':'application/json','.png':'image/png','.ico':'image/x-icon'
};

http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(__dirname,'index.html'), (e2,d2) => {
        res.writeHead(200,{'Content-Type':'text/html'});
        res.end(d2);
      });
      return;
    }
    res.writeHead(200,{'Content-Type': MIME[ext]||'text/plain'});
    res.end(data);
  });
}).listen(PORT, () => console.log(`Colindante Dashboard corriendo en puerto ${PORT}`));
