import os

from flask import Flask, render_template, jsonify, request, session
from dotenv import load_dotenv
try:
    from groq import Groq
except ImportError:
    Groq = None
import json
from pathlib import Path
from database import get_db_connection, search_medicine
from triage import detect_red_flags


# ---------------------------------------------------------
# Load configuration
# ---------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent

RED_FLAGS_FILE = BASE_DIR / "red_flags.json"

with open(RED_FLAGS_FILE, "r", encoding="utf-8") as file:
    RED_FLAGS = json.load(file)


load_dotenv()


# ---------------------------------------------------------
# Flask app
# ---------------------------------------------------------

app = Flask(__name__)

app.config["SECRET_KEY"] = os.getenv("SECRET_KEY") or "dev-secret-key-change-me"
app.secret_key = app.config["SECRET_KEY"]


# ---------------------------------------------------------
# Conversation history
# ---------------------------------------------------------

conversation_history = []


# ---------------------------------------------------------
# Assessment helper
# ---------------------------------------------------------

def get_next_assessment_question(assessment):
    """
    Return the next unanswered assessment question.
    """

    questions = assessment.get("questions", [])
    current_question = assessment.get("current_question", 0)

    if current_question >= len(questions):
        return None

    return questions[current_question]


# ---------------------------------------------------------
# Groq client
# ---------------------------------------------------------

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
client = Groq(api_key=GROQ_API_KEY) if (Groq and GROQ_API_KEY) else None


def ensure_ai_client():
    """Ensure the AI client is configured and dynamically reload env vars if needed."""
    global client
    if Groq is None:
        raise RuntimeError(
            "The 'groq' package is not installed in your Python environment. Run: pip install groq"
        )
    if client is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            env_file = BASE_DIR / ".env"
            if env_file.exists():
                load_dotenv(env_file)
                api_key = os.getenv("GROQ_API_KEY")
        if api_key:
            client = Groq(api_key=api_key)

    if client is None:
        raise RuntimeError(
            "GROQ_API_KEY is missing. If you are on Vercel, go to your Vercel Dashboard -> Project Settings -> "
            "Environment Variables, add 'GROQ_API_KEY', and redeploy."
        )
    return client


def create_groq_completion(messages):
    """
    Query Groq with fallback model support to ensure high availability.
    """
    ai_client = ensure_ai_client()
    models_to_try = [
        "openai/gpt-oss-120b",
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "mixtral-8x7b-32768"
    ]
    last_err = None
    for model_name in models_to_try:
        try:
            return ai_client.chat.completions.create(
                model=model_name,
                messages=messages
            )
        except Exception as e:
            last_err = e
            print(f"Model {model_name} notice: {e}. Trying fallback model...")
            continue
    raise last_err


# ---------------------------------------------------------
# Home page
# ---------------------------------------------------------

@app.route("/")
def home():
    return render_template("index.html")


# ---------------------------------------------------------
# Health check
# ---------------------------------------------------------

@app.route("/api/health")
def health():
    return jsonify({
        "status": "success",
        "message": "MediGuide AI backend is operational",
        "version": "2.4.0"
    })


# ---------------------------------------------------------
# Medicine Knowledge Base Directory
# ---------------------------------------------------------

@app.route("/api/medicines", methods=["GET"])
def get_medicines():
    from database import FALLBACK_MEDICINES
    return jsonify({
        "status": "success",
        "medicines": list(FALLBACK_MEDICINES.values())
    })


# ---------------------------------------------------------
# Chat API
# ---------------------------------------------------------

@app.route("/api/chat", methods=["POST"])
def chat():

    data = request.get_json(silent=True) or {}

    user_message = (data.get("message") or "").strip()

    if not user_message:
        return jsonify({
            "error": "Message cannot be empty"
        }), 400


    # -----------------------------------------------------
    # STEP 1 — Always run safety / triage first
    # -----------------------------------------------------

    triage_result = detect_red_flags(user_message)


    # -----------------------------------------------------
    # STEP 2 — Emergency handling
    # -----------------------------------------------------

    if triage_result["triage_level"] == "emergency":

        # Emergency overrides any active assessment
        session.pop("assessment", None)

        safety_reply = (
            "Your message contains symptoms that may require immediate "
            "medical attention. Please seek urgent medical help now or "
            "contact your local emergency service. Do not rely on this "
            "chatbot for emergency care."
        )

        return jsonify({
            "reply": safety_reply,
            "triage_level": "emergency",
            "safety_alert": True,
            "signals": triage_result["signals"]
        })


    # -----------------------------------------------------
    # STEP 3 — Urgent handling
    # -----------------------------------------------------

    if triage_result["triage_level"] == "urgent":

        # Stop the current assessment because a more urgent
        # symptom has appeared.
        session.pop("assessment", None)

        safety_reply = (
            "Your symptoms may need prompt medical assessment. "
            "Please contact a qualified healthcare professional or "
            "appropriate medical service soon. This chatbot cannot "
            "determine the cause or severity of your symptoms."
        )

        return jsonify({
            "reply": safety_reply,
            "triage_level": "urgent",
            "safety_alert": True,
            "signals": triage_result["signals"]
        })


    # -----------------------------------------------------
    # STEP 4 — Continue existing assessment
    # -----------------------------------------------------

    existing_assessment = session.get("assessment")

    if existing_assessment:

        current_question = get_next_assessment_question(
            existing_assessment
        )

        if current_question:

            # Save the user's answer
            existing_assessment["answers"].append({
                "question": current_question,
                "answer": user_message
            })

            # Move to next question
            existing_assessment["current_question"] += 1

            next_question = get_next_assessment_question(
                existing_assessment
            )

            # -------------------------------------------------
            # More questions remain
            # -------------------------------------------------

            if next_question:

                session["assessment"] = existing_assessment

                return jsonify({
                    "reply": next_question,
                    "triage_level": "caution",
                    "safety_alert": False,
                    "assessment_active": True
                })

            # -------------------------------------------------
            # Assessment complete
            # -------------------------------------------------

            else:
                answers = existing_assessment["answers"]
                symptom = existing_assessment["symptom"]

                # Remove assessment from session
                session.pop("assessment", None)

                # Build a summary of the user's answers
                assessment_summary = "\n".join(
                    f"- {item['question']}: {item['answer']}"
                    for item in answers
                )

                # Ask Groq to provide general medical information
                completion = create_groq_completion([
                    {
                        "role": "system",
                        "content": (
                            "You are MediGuide AI, a medical information "
                            "assistant. Provide general educational health "
                            "information only. Do not diagnose diseases. "
                            "Do not prescribe medicines or dosages. "
                            "Explain possible general causes, self-care "
                            "considerations, warning signs, and when the "
                            "user should consult a healthcare professional. "
                            "Do not present your response as a diagnosis."
                        )
                    },
                    {
                        "role": "user",
                        "content": (
                            f"The user is asking about: "
                            f"{symptom.replace('_', ' ')}\n\n"
                            "Here is the information collected during "
                            "the initial assessment:\n"
                            f"{assessment_summary}\n\n"
                            "Based on this information, provide a helpful "
                            "general medical-information response. "
                            "Clearly mention any warning signs that would "
                            "require urgent medical attention."
                        )
                    }
                ])

                # Get AI response
                reply = completion.choices[0].message.content

                # -------------------------------------------------
                # Save completed assessment to MySQL (optional/graceful)
                # -------------------------------------------------
                connection = None
                cursor = None
                try:
                    connection = get_db_connection()
                    cursor = connection.cursor(dictionary=True)
                    conversation_id = session.get("conversation_id")

                    # Create a conversation if one does not exist
                    if not conversation_id:
                        cursor.execute(
                            "INSERT INTO conversations (title) VALUES (%s)",
                            ("MediGuide AI Chat",)
                        )
                        connection.commit()
                        conversation_id = cursor.lastrowid
                        session["conversation_id"] = conversation_id

                    # Save assessment summary
                    assessment_message = (
                        f"Symptom assessment: "
                        f"{symptom.replace('_', ' ')}\n\n"
                        f"{assessment_summary}"
                    )

                    cursor.execute(
                        "INSERT INTO messages (conversation_id, role, content) VALUES (%s, %s, %s)",
                        (conversation_id, "system", assessment_message)
                    )

                    # Save AI response
                    cursor.execute(
                        "INSERT INTO messages (conversation_id, role, content) VALUES (%s, %s, %s)",
                        (conversation_id, "assistant", reply)
                    )
                    connection.commit()
                except Exception as e:
                    print("ASSESSMENT DATABASE NOTICE (non-fatal):", repr(e))
                finally:
                    if cursor:
                        cursor.close()
                    if connection:
                        connection.close()

                return jsonify({
                    "reply": reply,
                    "triage_level": "caution",
                    "safety_alert": False,
                    "assessment_complete": True,
                    "answers": answers
                })


    # -----------------------------------------------------
    # STEP 5 — Start a new caution assessment
    # -----------------------------------------------------

    if triage_result["triage_level"] == "caution":

        follow_up_questions = triage_result.get(
            "follow_up_questions",
            []
        )

        session["assessment"] = {
            "symptom": triage_result["signals"][0]["signal"],
            "questions": follow_up_questions,
            "current_question": 0,
            "answers": []
        }

        first_question = get_next_assessment_question(
            session["assessment"]
        )

        caution_reply = (
            "I'd like to understand your symptoms a little better "
            "before providing general medical information.\n\n"
            f"{first_question}"
        )

        return jsonify({
            "reply": caution_reply,
            "triage_level": "caution",
            "safety_alert": False,
            "signals": triage_result["signals"],
            "follow_up_questions": follow_up_questions,
            "assessment_active": True
        })


    # ---------------------------------------------------------
    # STEP 6 — Normal / routine medical flow
    # ---------------------------------------------------------

    connection = None
    cursor = None
    conversation_id = None
    previous_messages = []

    # ---------------------------------------------------------
    # Search medical database
    # ---------------------------------------------------------
    medicine_info = None
    common_medicines = [
        "paracetamol",
        "acetaminophen",
        "ibuprofen",
        "cetirizine",
        "aspirin",
        "omeprazole"
    ]

    for medicine_name in common_medicines:
        if medicine_name in user_message.lower():
            medicine_info = search_medicine(medicine_name)
            break

    # ---------------------------------------------------------
    # Database or Session persistence
    # ---------------------------------------------------------
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        conversation_id = session.get("conversation_id")
        if not conversation_id:
            cursor.execute(
                "INSERT INTO conversations (title) VALUES (%s)",
                ("MediGuide AI Chat",)
            )
            connection.commit()
            conversation_id = cursor.lastrowid
            session["conversation_id"] = conversation_id

        cursor.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (%s, %s, %s)",
            (conversation_id, "user", user_message)
        )
        connection.commit()

        cursor.execute(
            "SELECT role, content FROM messages WHERE conversation_id = %s ORDER BY id ASC",
            (conversation_id,)
        )
        previous_messages = cursor.fetchall() or []
    except Exception as db_err:
        print("DATABASE NOTICE (fallback to session):", repr(db_err))
        if "session_messages" not in session:
            session["session_messages"] = []
        session["session_messages"].append({"role": "user", "content": user_message})
        # Keep recent 8 messages for context
        previous_messages = session["session_messages"][-8:]

    # ---------------------------------------------------------
    # Build medical database context
    # ---------------------------------------------------------
    medical_context = ""
    if medicine_info:
        medical_context = f"""
Medical information from MediGuide's database:

Medicine: {medicine_info['name']}
Generic name: {medicine_info.get('generic_name', medicine_info['name'])}
Category: {medicine_info.get('category', 'Medical Product')}
Common uses: {medicine_info.get('common_uses', 'N/A')}
Common side effects: {medicine_info.get('common_side_effects', 'N/A')}
Precautions: {medicine_info.get('precautions', 'N/A')}

Use this database information when answering the user's question.
Do not invent medical information that contradicts the database.
"""

    # ---------------------------------------------------------
    # Send conversation to Groq
    # ---------------------------------------------------------
    try:
        completion = create_groq_completion(
            [
                {
                    "role": "system",
                    "content": (
                        "You are MediGuide AI, an intelligent, empathetic medical information assistant. "
                        "Provide clear, educational health information with structured formatting (bullet points, bold highlights). "
                        "Do not diagnose diseases or prescribe exact medicines or dosages. "
                        "Encourage users to consult a qualified doctor or pharmacist when appropriate. "
                        "If a user describes possible emergency symptoms, advise them to seek urgent medical care immediately."
                    )
                },
                {
                    "role": "system",
                    "content": medical_context
                }
            ] + previous_messages
        )

        reply = completion.choices[0].message.content

        # Save AI response to DB if available
        if cursor and connection and conversation_id:
            try:
                cursor.execute(
                    "INSERT INTO messages (conversation_id, role, content) VALUES (%s, %s, %s)",
                    (conversation_id, "assistant", reply)
                )
                connection.commit()
            except Exception as e:
                print("Failed to save assistant response to DB:", repr(e))

        if "session_messages" in session:
            session["session_messages"].append({"role": "assistant", "content": reply})

        response_data = {
            "reply": reply,
            "triage_level": "routine",
            "safety_alert": False
        }
        if medicine_info:
            response_data["medicine_info"] = medicine_info

        return jsonify(response_data)

    except Exception as e:
        print("AI COMPLETION ERROR:", repr(e))
        return jsonify({
            "error": f"AI service error: {str(e)}"
        }), 500

    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


# ---------------------------------------------------------
# Run application
# ---------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True)