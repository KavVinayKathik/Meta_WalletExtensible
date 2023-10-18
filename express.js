var express = require('express');
var app = express();
const session = require('express-session');
const admin = require("firebase-admin");
var serviceAccount = require("./project-fstack-firebase-adminsdk-ckmd6-d9d71490f9.json");
const path = require('path');
const ejs = require('ejs');

const firebaseStorageBucket = "gs://project-fstack.appspot.com"; // Renamed this variable
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: firebaseStorageBucket
});
const bcrypt = require('bcrypt');
app.use(session({
    secret: '123456',
    resave: false,
    saveUninitialized: true
}));

const hashPassword = async (password) => {
    const saltRounds = 10; // Number of salt rounds (adjust as needed)
    return bcrypt.hash(password, saltRounds);
};

const db = admin.firestore();
const firebaseStorage = admin.storage().bucket(); // Keep this variable name

const multer = require('multer');

// Define the storage for uploaded files
const multerStorage = multer.diskStorage({ // Changed the variable name here
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Set the destination directory for uploaded files
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname); // Set the filename for the uploaded file
  },
});

// Create an instance of multer with the specified storage options
const upload = multer({ storage: multerStorage }); // Changed the variable name here



app.use(express.static('public'));
app.use(express.urlencoded({ extended: true })); // Middleware to parse POST request data

app.get('/signup', function (req, res) {
    res.sendFile(__dirname + "/signup.html");
});

app.post('/retrievesignup', async function (req, res) {
    const { fullname, email, password } = req.body; // Use req.body to retrieve form data

    try {
        const hashedPassword = await hashPassword(password); // Hash the password

        // Check if the email already exists in the database
        const emailExists = await checkEmailExists(email);

        if (emailExists) {
            res.send("Email already exists. Please choose a different email.");
        } else {
            // Store the hashed password in the database
            await db.collection('UserDetails').doc(email).set({
                Full_Name: fullname,
                Email: email,
                Password: hashedPassword // Store the hashed password
            });

            // Add a login button along with the success message
            res.send(`
                <p>Successfully Registered!</p>
                <style>
    a {
      color: white;
      font-size: 80px;
      background-color: skyblue;
      transition: background-color 0.3s, color 0.3s;
    }

    a:hover {
      background-color: lightblue;
      color: black;
    }
  </style>
                <a href="http://localhost:4000/login" style="color:white;font-size:80px;background-color:skyblue">Login</a>
            `);
        }
    } catch (error) {
        console.error("Error registering:", error);
        res.status(500).send("An error occurred while registering.");
    }
});


app.post('/retrievelogin', async function (req, res) {
    const email = req.body.email;
    const password = req.body.password;

    try {
        const querySnapshot = await db.collection('UserDetails').doc(email).get();

        if (querySnapshot.exists) {
            const userDoc = querySnapshot.data();
            const hashedPassword = userDoc.Password;

            // Compare the entered password with the stored hashed password
            const passwordMatch = await bcrypt.compare(password, hashedPassword);

            if (passwordMatch) {
                req.session.email = email;
                const fullName = userDoc.Full_Name;
                res.redirect(`http://localhost:4000/dashboard?fullName=${fullName}&email=${email}`);
            } else {
                res.send("Login Failed. Please check your credentials.");
            }
        } else {
            res.send("Login Failed. Please check your credentials.");
        }
    } catch (error) {
        console.error("Error logging in:", error);
        res.status(500).send("An error occurred while logging in.");
    }
});
async function checkEmailExists(email) {
    const docRef = db.collection('UserDetails').doc(email);
    const doc = await docRef.get();
    return doc.exists;
}

// Add routes for storing passwords, card details, ID proofs, and notes as subcollections
app.post('/addpassword', function (req, res) {
    const { website, password } = req.body;

    // Check if the user is logged in by verifying if the email is present in the session
    if (!req.session.email) {
        console.error("Email is missing in the session.");
        return res.status(400).send("Email is required.");
    }

    const userEmail = req.session.email;

    // Get the user document based on the provided email
    const userRef = db.collection('UserDetails').doc(userEmail);

    // Check if the user document exists
    userRef.get()
        .then((docSnapshot) => {
            if (docSnapshot.exists) {
                // User document exists, reference the "passwords" subcollection
                const passwordsCollectionRef = userRef.collection('Passwords');

                // Add the password as a new document in the "passwords" subcollection
                return passwordsCollectionRef.add({
                    website: website,
                    password: password
                });
            } else {
                res.send("User not found.");
            }
        })
        .then(() => {
            res.send(`<p>Password Successfully Stored</p>
            <style>
    a {
      transition: background-color 0.3s, color 0.3s;
    }

    a:hover {
      background-color: lightblue;
      color: black;
      font-size:60px
    }
  </style>
            <a href="http://localhost:4000/index" style="color:white;font-size:40px;background-color:skyblue">View Passwords</a>`);
            
        })
        .catch((error) => {
            console.error("Error storing password:", error);
            res.status(500).send("An error occurred while storing the password.");
        });
});




app.post('/carddetails', upload.single('image'), async (req, res) => {
    const { email, cardnumber, expirationdate, cvv } = req.body;
    const userEmail = req.session.email;

    // Reference to Firestore collection
    const cardRef = db.collection('UserDetails').doc(userEmail).collection('CardDetails');

    try {
        // Upload the image to Firebase Storage
        const image = req.file;
        if (!image) {
            return res.status(400).send('No image file provided.');
        }
        
        const imageUploadResponse = await firebaseStorage.upload(image.path); // Changed this line
        const imageUrl = imageUploadResponse[0].metadata.mediaLink;

        // Store the ID proof details, including the image URL, in Firestore
        await cardRef.add({
            cardnumber: cardnumber,
            expirationdate: expirationdate,
            cvv: cvv,
            Image: imageUrl
        });

        res.send(`
            <p>Your Card Details Successfully Stored!</p>
            <a href="http://localhost:4000/card1" style="color:white;font-size:40px;background-color:skyblue">View ID Proofs</a>
        `);
    } catch (error) {
        console.error('Error storing card details:', error);
        res.status(500).send('An error occurred while storing card details.');
    }
});


app.post('/idproof', upload.single('image'), async (req, res) => {
    const { email, prooftype, name, proofnumber } = req.body;
    const userEmail = req.session.email;

    // Reference to Firestore collection
    const idProofsRef = db.collection('UserDetails').doc(userEmail).collection('IdProofs');

    try {
        // Upload the image to Firebase Storage
        const image = req.file;
        if (!image) {
            return res.status(400).send('No image file provided.');
        }
        
        const imageUploadResponse = await firebaseStorage.upload(image.path); // Changed this line
        const imageUrl = imageUploadResponse[0].metadata.mediaLink;

        // Store the ID proof details, including the image URL, in Firestore
        await idProofsRef.add({
            ProofType: prooftype,
            ApplicantName: name,
            ProofID: proofnumber,
            Image: imageUrl, // Store the image URL
        });

        res.send(`
            <p>Your ID Proof Details Successfully Stored!</p>
            <a href="http://localhost:4000/proof1" style="color:white;font-size:40px;background-color:skyblue">View ID Proofs</a>
        `);
    } catch (error) {
        console.error('Error storing ID proof details:', error);
        res.status(500).send('An error occurred while storing ID proof details.');
    }
});
app.post('/newnotes', upload.single('file'), async (req, res) => {
    const { email,  notetitle, notecontent } = req.body;
    const userEmail = req.session.email;

    // Reference to Firestore collection
    const idProofsRef = db.collection('UserDetails').doc(userEmail).collection('Notes');

    try {
        // Upload the image to Firebase Storage
        const image = req.file;
        if (!image) {
            return res.status(400).send('No image file provided.');
        }
        
        const imageUploadResponse = await firebaseStorage.upload(image.path); // Changed this line
        const imageUrl = imageUploadResponse[0].metadata.mediaLink;

        // Store the ID proof details, including the image URL, in Firestore
        await idProofsRef.add({
            Title: notetitle,
            Content: notecontent,
            Image: imageUrl, // Store the image URL
        });

        res.send(`
            <p>Your File/Note Details Successfully Stored!</p>
            <a href="http://localhost:4000/notes" style="color:white;font-size:40px;background-color:skyblue">View ID Proofs</a>
        `);
    } catch (error) {
        console.error('Error storing File details:', error);
        res.status(500).send('An error occurred while storing File details.');
    }
});



app.get('/login', function (req, res) {
   /* if (req.session.email) {
        // If logged in, ask the user to log out first
        return res.send('You are already logged in. Please log out before accessing the login page. <a href="/login">Logout</a>');
    }*/
    res.sendFile(__dirname + "/login.html");
});

function isAuthenticated(req,res,next){
    if(req.session.email){
        return next()
    }
    else{
        res.redirect('/login')
    }
}

app.get('/dashboard',isAuthenticated, function (req, res) {
    res.sendFile(__dirname + "/dashboard.html");
});

app.get('/sample',isAuthenticated, function (req, res) {
    res.sendFile(__dirname + "/sample.html");
});

app.get('/card', isAuthenticated,function (req, res) {
    res.sendFile(__dirname + "/card.html");
});

app.get('/proof',isAuthenticated, function (req, res) {
    res.sendFile(__dirname + "/proof.html");
});

app.get('/blank',isAuthenticated, function (req, res) {
    res.sendFile(__dirname + "/blank.html");
});

app.get('/landing', function (req, res) {
    res.sendFile(__dirname + "/landing.html");
});



app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const userDetailsCollectionRef = admin.firestore().collection("UserDetails");

// Create a route to render the dynamic data
app.get('/index', async (req, res) => {
    try {
        const data = [];
        const userEmail = req.session.email; // Replace with the user's email you want to retrieve data for
        if (!userEmail) {
            // Handle the case where the user's email is not in the session
            return res.status(400).send("Login First!!");
        }
        // Retrieve the user's document based on the provided email
        const userDocRef = userDetailsCollectionRef.doc(userEmail);
        const userDocSnapshot = await userDocRef.get();

        if (userDocSnapshot.exists) {
            // User document exists, retrieve data from subcollections
            const cardDetailsQuerySnapshot = await userDocRef.collection('CardDetails').get();
            cardDetailsQuerySnapshot.forEach((cardDoc) => {
                data.push({ type: 'CardDetails', ...cardDoc.data() });
            });

            const idProofsQuerySnapshot = await userDocRef.collection('IdProofs').get();
            idProofsQuerySnapshot.forEach((idProofDoc) => {
                data.push({ type: 'IdProofs', ...idProofDoc.data() });
            });

            const notesQuerySnapshot = await userDocRef.collection('Notes').get();
            notesQuerySnapshot.forEach((noteDoc) => {
                data.push({ type: 'Notes', ...noteDoc.data() });
            });

            const passwordsQuerySnapshot = await userDocRef.collection('Passwords').get();
            passwordsQuerySnapshot.forEach((passwordDoc) => {
                data.push({ type: 'Passwords', ...passwordDoc.data() });
            });
        }

        // Render the 'index.ejs' template and pass the data to it
        res.render('index', { data,index:0 });
    } catch (error) {
        console.error("Error retrieving data: ", error);
        res.status(500).send("An error occurred while retrieving data.");
    }
});

app.get('/index',isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


app.get('/proof1', isAuthenticated,async (req, res) => {
    try {
        const data = [];
        const userEmail = req.session.email; // Replace with the user's email you want to retrieve IDProofs for

        // Retrieve the user's document based on the provided email
        const userDocRef = userDetailsCollectionRef.doc(userEmail);
        const userDocSnapshot = await userDocRef.get();

        if (userDocSnapshot.exists) {
            // User document exists, retrieve IDProofs data from the "IdProofs" subcollection
            const idProofsQuerySnapshot = await userDocRef.collection('IdProofs').get();
            idProofsQuerySnapshot.forEach((idProofDoc) => {
                data.push(idProofDoc.data());
            });

            // Render the 'proof1.ejs' template and pass the data to it
            res.render('proof1', { data,index:0 });
        } else {
            res.status(404).send("User not found.");
        }
    } catch (error) {
        console.error("Error retrieving IDProof data: ", error);
        res.status(500).send("An error occurred while retrieving IDProof data.");
    }
});



app.get('/proof1',isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'proof1.html'));
});




// Create a route to render the dynamic data for Credit/Debit Cards
app.get('/card1', async (req, res) => {
    try {
        const data = [];
        const userEmail = req.session.email; // Replace with the user's email you want to retrieve CardDetails for

        // Retrieve the user's document based on the provided email
        const userDocRef = userDetailsCollectionRef.doc(userEmail);
        const userDocSnapshot = await userDocRef.get();

        if (userDocSnapshot.exists) {
            // User document exists, retrieve CardDetails data from the "CardDetails" subcollection
            const cardDetailsQuerySnapshot = await userDocRef.collection('CardDetails').get();
            cardDetailsQuerySnapshot.forEach((cardDoc) => {
                data.push(cardDoc.data());
            });

            // Render the 'card1.ejs' template and pass the data to it
            res.render('card1', { data,index:0 });
        } else {
            res.status(404).send("User not found.");
        }
    } catch (error) {
        console.error("Error retrieving card data: ", error);
        res.status(500).send("An error occurred while retrieving card data.");
    }
});


app.get('/card1', isAuthenticated,(req, res) => {
    res.sendFile(path.join(__dirname, 'card1.html'));
});

app.get('/notes', async (req, res) => {
    try {
        const data = [];
        const userEmail = req.session.email; // Replace with the user's email you want to retrieve Notes for

        // Retrieve the user's document based on the provided email
        const userDocRef = userDetailsCollectionRef.doc(userEmail);
        const userDocSnapshot = await userDocRef.get();

        if (userDocSnapshot.exists) {
            // User document exists, retrieve Notes data from the "Notes" subcollection
            const notesQuerySnapshot = await userDocRef.collection('Notes').get();
            notesQuerySnapshot.forEach((noteDoc) => {
                data.push(noteDoc.data());
            });

            // Render the 'notes.ejs' template and pass the data to it
            res.render('notes', { data,index:0 });
        } else {
            res.status(404).send("User not found.");
        }
    } catch (error) {
        console.error("Error retrieving notes data: ", error);
        res.status(500).send("An error occurred while retrieving notes data.");
    }
});

app.get('/notes',isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'notes.html'));
});



// Add a route to handle card deletion
app.delete('/deletecard', async (req, res) => {
    try {
        const userEmail = req.session.email; // Get the user's email
        const { index } = req.query; // Get the index of the card to delete

        // Retrieve the user's document based on the provided email
        const userDocRef = userDetailsCollectionRef.doc(userEmail);
        const userDocSnapshot = await userDocRef.get();

        if (userDocSnapshot.exists) {
            // User document exists, delete the card at the specified index
            const cardDetailsQuerySnapshot = await userDocRef.collection('CardDetails').get();
            const cardToDelete = cardDetailsQuerySnapshot.docs[index];

            if (cardToDelete) {
                // Delete the card document
                await cardToDelete.ref.delete();
                res.json({ success: true });
            } else {
                res.json({ success: false, message: 'Card not found.' });
            }
        } else {
            res.json({ success: false, message: 'User not found.' });
        }
    } catch (error) {
        console.error("Error deleting card:", error);
        res.json({ success: false, message: 'An error occurred while deleting the card.' });
    }
});

app.delete('/deleteproof', async (req, res) => {
    try {
        const userEmail = req.session.email; // Get the user's email
        const { index } = req.query; // Get the index of the card to delete

        // Retrieve the user's document based on the provided email
        const userDocRef = userDetailsCollectionRef.doc(userEmail);
        const userDocSnapshot = await userDocRef.get();

        if (userDocSnapshot.exists) {
            // User document exists, delete the card at the specified index
            const cardDetailsQuerySnapshot = await userDocRef.collection('IdProofs').get();
            const cardToDelete = cardDetailsQuerySnapshot.docs[index];

            if (cardToDelete) {
                // Delete the card document
                await cardToDelete.ref.delete();
                res.json({ success: true });
            } else {
                res.json({ success: false, message: 'Card not found.' });
            }
        } else {
            res.json({ success: false, message: 'User not found.' });
        }
    } catch (error) {
        console.error("Error deleting card:", error);
        res.json({ success: false, message: 'An error occurred while deleting the card.' });
    }
});


app.delete('/deletenotes', async (req, res) => {
    try {
        const userEmail = req.session.email; // Get the user's email
        const { index } = req.query; // Get the index of the card to delete

        // Retrieve the user's document based on the provided email
        const userDocRef = userDetailsCollectionRef.doc(userEmail);
        const userDocSnapshot = await userDocRef.get();

        if (userDocSnapshot.exists) {
            // User document exists, delete the card at the specified index
            const cardDetailsQuerySnapshot = await userDocRef.collection('Notes').get();
            const cardToDelete = cardDetailsQuerySnapshot.docs[index];

            if (cardToDelete) {
                // Delete the card document
                await cardToDelete.ref.delete();
                res.json({ success: true });
            } else {
                res.json({ success: false, message: 'Card not found.' });
            }
        } else {
            res.json({ success: false, message: 'User not found.' });
        }
    } catch (error) {
        console.error("Error deleting card:", error);
        res.json({ success: false, message: 'An error occurred while deleting the card.' });
    }
});


app.delete('/deletepassword', async (req, res) => {
    try {
        const userEmail = req.session.email; // Get the user's email
        const { index } = req.query; // Get the index of the card to delete

        // Retrieve the user's document based on the provided email
        const userDocRef = userDetailsCollectionRef.doc(userEmail);
        const userDocSnapshot = await userDocRef.get();

        if (userDocSnapshot.exists) {
            // User document exists, delete the card at the specified index
            const cardDetailsQuerySnapshot = await userDocRef.collection('Passwords').get();
            const cardToDelete = cardDetailsQuerySnapshot.docs[index];

            if (cardToDelete) {
                // Delete the card document
                await cardToDelete.ref.delete();
                res.json({ success: true });
            } else {
                res.json({ success: false, message: 'Password not found.' });
            }
        } else {
            res.json({ success: false, message: 'User not found.' });
        }
    } catch (error) {
        console.error("Error deleting card:", error);
        res.json({ success: false, message: 'An error occurred while deleting the card.' });
    }
});
app.listen(4000, function () {
    console.log('Example app listening on port 4000!');
});
