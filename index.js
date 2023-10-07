let express = require('express');
let http = require('http');
let socketIo = require('socket.io');
let fs = require('fs');
let path = require('path');
let bodyParser = require('body-parser');


let app = express();
let server = http.createServer(app);
let io = socketIo(server);

app.use(express.static(__dirname + '/public'));
// settings ^^^

let id = 0
try {
  id = parseInt(fs.readFileSync("serverInfo/track-id.json", 'utf8'), 10);
} catch (error) {
  console.error('Error loading id users:', error.message);
}

app.get('/newID', (req, res) => {
  id+=1
  res.json({ id });

  fs.writeFileSync("serverInfo/track-id.json", id.toString(), 'utf8');
});


let bannedUsers = [];
try {
  let bannedUsersData = fs.readFileSync("serverInfo/banned-users.json", 'utf8');
  bannedUsers = JSON.parse(bannedUsersData);
} catch (error) {
  console.error('Error loading banned users:', error.message);
}
// detect if new user is banned
app.get('/getBannedUsers', (req, res) => {
  try {
    let bannedUsersData = fs.readFileSync("serverInfo/banned-users.json", 'utf8');
    bannedUsers = JSON.parse(bannedUsersData);
  } catch (error) {
    console.error('Error loading banned users:', error.message);
  }
  res.json({ bannedUsers });
});

let users = []
try {
  let userData = fs.readFileSync("serverInfo/users.json", 'utf8');
  users = JSON.parse(userData);
} catch (error) {
  console.error('Error loading users:', error.message);
}


let chatHistory = []
try {
  let chatLog = fs.readFileSync("serverInfo/chat-log.json", 'utf8');
  chatHistory = JSON.parse(chatLog);
} catch (error) {
  console.error('Error loading history chat:', error.message);
}
let reportedHistory = []
try {
  let reportedHistoryData = fs.readFileSync("reported-info.json", 'utf8');
  reportedHistory = JSON.parse(reportedHistoryData);
} catch (error) {
  console.error('Error loading history users:', error.message);
}


io.on('connection', (socket) => {
  socket.on('new connection', (info) => {
    let duplicate = false
    for (let i = 0; i<users.length; i++) {
      if (users[i].username.replace(/\s/g, "") == info.username.replace(/\s/g, "")) {
        duplicate = true
      }
    }
    if (duplicate == false) {
      users.push(info)
      io.emit('update user', users);
      fs.writeFileSync("serverInfo/users.json", JSON.stringify(users, null, 2), 'utf8');
    }
    else if (duplicate == true && info.new == true) {
      socket.emit("rechoose", info)
    }
  });
  socket.on('userDisconnect', (id) => {
    for (let i = 0; i<users.length; i++) {
      if (users[i].id == id) {
        users.splice(i, 1)
        io.emit('update user', users);
        fs.writeFileSync("serverInfo/users.json", JSON.stringify(users, null, 2), 'utf8');
      }
    }
  });
  socket.on('chat message', (msg) => {
    const promises = [];

    for (let i = 0; i < msg.message.length; i++) {
      const inputText = msg.message[i].msg;
      if (inputText != "") {
        const promise = profanityFilter(inputText)
        .then(result => {
          msg.message[i].msg = result;
        })
        .catch(error => {
          console.error('Error:', error);
        });
        promises.push(promise);
      }
    }
    
    // Use Promise.all to wait for all promises to resolve
    Promise.all(promises)
    .then(() => {
      io.emit('chat message', msg);
      chatHistory.push(msg);
      fs.writeFileSync("serverInfo/chat-log.json", `[${chatHistory.map(JSON.stringify).join(',')}]`, 'utf8');
    })
    .catch(error => {
      console.error('Error:', error);
    });
  });
  socket.on('delete message', (parameter) =>{
    if (parameter.index < chatHistory.length) {
      chatHistory.splice(parameter.index, 1)
    }
    fs.writeFileSync("serverInfo/chat-log.json", `[${chatHistory.map(JSON.stringify).join(',')}]`, 'utf8');
    io.emit('delete message', {index: parameter.index, msg: parameter.msg});
  });
  socket.on('report message', (info) =>{
    reportedHistory.push(info)
    fs.writeFileSync("reported-info.json", JSON.stringify(reportedHistory, null, 2), 'utf8');
  });
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
  socket.on('banning', () => {
    io.emit('banning');
  });
  socket.on('shutdown', () => {
    io.emit('refresh');
  });
  socket.on('appealID', (appealID) => {
    console.log(appealID);
  });
});


// store appeal submissions and user appeals count
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

let submissions = [];
try {
  let subData = fs.readFileSync("submissionFiles/submissions.json", 'utf8');
  submissions = JSON.parse(subData);
} catch (error) {
  console.error('Error loading submissions:', error.message);
}
let userAppealsCount = {};
try {
  let userAppealData = fs.readFileSync("submissionFiles/userAppealsCount.json", 'utf8');
  userAppealsCount = JSON.parse(userAppealData);
} catch (error) {
  console.error('Error loading userAppealData:', error.message);
}

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.post('/submit', (req, res) => {
  let formData = req.body;
  let userId = formData.id;

  if (userAppealsCount[userId] && userAppealsCount[userId] >= 2) {
    return res.send('You cannot appeal more than twice');
  }

  let submission = {
    name: formData.name,
    reason: formData.reason,
    email: formData.email,
    id: formData.id
  };

  submissions.push(submission);
  fs.writeFileSync("submissionFiles/submissions.json", JSON.stringify(submissions, null, 2), 'utf8');

  userAppealsCount[userId] = (userAppealsCount[userId] || 0) + 1;
  fs.writeFileSync("submissionFiles/userAppealsCount.json", JSON.stringify(userAppealsCount, null, 2), 'utf8');

  res.send(`Form submitted successfully, you have ${2-userAppealsCount[userId]} appeals left`);
});


app.get('/gethistory', (req, res) => {
  res.json({ chatHistory });
});
app.get('/activeUsers', (req, res) => {
  res.json({ users });
});


// refresh admin page
app.get('/refreshBanPager', (req, res) => {

  const responseHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        .refresh-button {
          background-color: #4CAF50; /* Green background color */
          border: none; /* No border */
          color: white; /* White text color */
          padding: 10px 20px; /* Padding around the text */
          text-align: center; /* Center the text */
          text-decoration: none; /* Remove underlines from links */
          display: inline-block; /* Display as an inline-level block */
          font-size: 16px; /* Font size */
          margin: 10px 2px; /* Margin around the button */
          cursor: pointer; /* Cursor style on hover */
          border-radius: 5px; /* Rounded corners */
          transition: background-color 0.3s; /* Smooth background color transition */
        }
        
        .refresh-button:hover {
          background-color: #45a049;
        }
      </style>
    </head>
    <body>
      <button class="refresh-button" onclick="socket.emit('banning');">Refresh Banned File</button>
      <script src="/socket.io/socket.io.js"></script>
      <script>
        const socket = io();
      </script>
    </body>
    </html>
  `;

  res.send(responseHtml);
});

app.get('/refreshAllPager', (req, res) => {

  const responseHtml = `
    
    <h1>Password Check</h1>
    <input type="password" id="passwordInput" placeholder="Enter your password">
    <button id="checkButton">Check Password</button>
    <p id="resultMessage"></p>

    <script src="/socket.io/socket.io.js"></script>
    <script src="refreshPage.js"></script>
    <script>
      document.getElementById('checkButton').addEventListener('click', () => {
        const passwordInput = document.getElementById('passwordInput').value;
        fetch('/checkPassword', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ password: passwordInput }),
        })
        .then((response) => {
          if (response.ok) {
            return response.json();
          } else {
            throw new Error('Network response to password to admin was not ok');
          }
        })
        .then((data) => {
          if (data.success == true) {
            document.getElementById('resultMessage').textContent = 'Password matches!';
            adminRefreshPage()
          } else {
            document.getElementById('resultMessage').textContent = 'Password does not match.';
          }
        })
        .catch((error) => {
          console.error('Error:', error);
        });
      });
    </script>
  `;

  res.send(responseHtml);
});



let PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// admin password hashing
let bcrypt = require('bcryptjs');
const salt = 10;

let db = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: path.resolve(__dirname, './db.db'),
  },
  useNullAsDefault: true
});


const hashedPasswords = JSON.parse(fs.readFileSync('serverInfo/password.txt', 'utf8'));
app.post('/checkPassword', (req, res) => {
  const { password } = req.body;
  let results = false;
  let completedComparisons = 0; // Initialize a counter for completed comparisons (cause stupid asynchronous)
  
  for (let i = 0; i < hashedPasswords.length; i++) {
    bcrypt.compare(password, hashedPasswords[i], (err, isMatch) => {
      if (err) {
        console.error(err);
      } else if (isMatch) {
        console.log(`Index ${i} is correct.`);
        results = true;
      } else if (!isMatch && !results) {
        console.log(`Index ${i} is incorrect.`);
        results = false;
      }
      
      completedComparisons++; // Increment the counter for completed comparisons
  
      if (completedComparisons === hashedPasswords.length) {
        // All comparisons have finished, so send the response
        console.log(results);
        res.json({ success: results });
      }
    });
  }


});





// push new password
// let newPass = JSON.parse(fs.readFileSync('serverInfo/password.txt', 'utf8'));

// bcrypt.hash("bruh", salt, (err, hash) => {
//   if (err) {
//     console.log(err);
//   } else {
//     newPass.push(hash);
//     fs.writeFile('serverInfo/password.txt', JSON.stringify(newPass), (writeErr) => {
//       if (writeErr) {
//         console.error(writeErr);
//       } else {
//         console.log('Hashed discount saved to password.txt');
//       }
//     });
//   }
// });

const rp = require('request-promise');

const apiKey = 'vQdD4CF7JKVNXgk9TwFv';

const apiUrl = 'https://api.sightengine.com/1.0/text/check.json';

function profanityFilter(inputText) {
  const options = {
    uri: apiUrl,
    qs: {
      models: 'profanity',
      text: inputText,
      mode: 'standard',
      lang: 'en',
    },
    headers: {
      'User-Agent': 'Request-Promise',
    },
    auth: {
      user: apiKey,
      pass: '', 
    },
    json: true,
  };
  return rp(options)
    .then((response) => {
      if (response.profanity.matches.length > 0) {
        let veryToxic = false;
        response.profanity.matches.forEach((match) => {
          console.log(match.intensity);
          if (match.intensity === 'high' || match.intensity === 'medium') {
            veryToxic = true;
          }
        });
        if (veryToxic) {
          const words = inputText.split(/\s+/);
          const hashedText = words.map(word => true ? '#'.repeat(word.length) : word).join(' ');
          return hashedText;
        } else {
          return inputText;
        }
      } else {
        return inputText;
      }
    })
    .catch((error) => {
      console.error('Error:', error);
      return 'An error occurred';
    });
}