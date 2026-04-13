from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
import os
from dotenv import load_dotenv

# Load the keys from your .env file
load_dotenv()

app = FastAPI()

# This is crucial: It allows your React app on port 5173 to talk to this Python app securely
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connect to the Supabase database
supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key)

# A simple check to make sure the server is alive
@app.get("/")
def health_check():
    return {"message": "SitePulse Backend is online and ready!"}

# We will build the PDF upload and export logic right below here later