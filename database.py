import os
from dotenv import load_dotenv

try:
    import mysql.connector
except ImportError:
    mysql = None

load_dotenv()

FALLBACK_MEDICINES = {
    "paracetamol": {
        "name": "Paracetamol",
        "generic_name": "Acetaminophen",
        "category": "Analgesic & Antipyretic",
        "common_uses": "Relief of mild to moderate pain (headache, toothache, muscle aches) and reduction of fever.",
        "common_side_effects": "Rare when taken as directed. Overdose may cause severe liver damage.",
        "precautions": "Do not exceed maximum daily limit (4000mg/day for adults). Avoid combining with other acetaminophen products and avoid heavy alcohol consumption."
    },
    "acetaminophen": {
        "name": "Acetaminophen",
        "generic_name": "Paracetamol",
        "category": "Analgesic & Antipyretic",
        "common_uses": "Temporary relief of minor aches, pains, headaches, and fever reduction.",
        "common_side_effects": "Generally well tolerated; excessive doses cause severe hepatic injury.",
        "precautions": "Never exceed recommended dosage. Always check labels on combination cold/flu products."
    },
    "ibuprofen": {
        "name": "Ibuprofen",
        "generic_name": "Ibuprofen",
        "category": "NSAID (Non-Steroidal Anti-Inflammatory Drug)",
        "common_uses": "Relieving pain, swelling, inflammation, and fever from headaches, muscle sprains, menstrual cramps, or arthritis.",
        "common_side_effects": "Stomach upset, indigestion, nausea, dizziness.",
        "precautions": "Take with food or milk to minimize gastrointestinal discomfort. Avoid if you have active stomach ulcers, serious renal issues, or unmanaged heart disease."
    },
    "cetirizine": {
        "name": "Cetirizine",
        "generic_name": "Cetirizine Hydrochloride",
        "category": "Antihistamine (2nd Generation)",
        "common_uses": "Relief of allergy symptoms including allergic rhinitis, hay fever, sneezing, itching, runny nose, and hives.",
        "common_side_effects": "Mild drowsiness, dry mouth, tiredness, headache.",
        "precautions": "Exercise caution when driving or operating machinery. Avoid heavy alcohol while taking."
    },
    "aspirin": {
        "name": "Aspirin",
        "generic_name": "Acetylsalicylic Acid",
        "category": "NSAID & Antiplatelet",
        "common_uses": "Pain relief, fever reduction, anti-inflammatory, and doctor-prescribed cardiovascular protection.",
        "common_side_effects": "Stomach irritation, increased bleeding risk, heartburn.",
        "precautions": "Never give to children or teenagers recovering from viral infections (risk of Reye's syndrome). Avoid if you have bleeding disorders or active ulcers."
    },
    "omeprazole": {
        "name": "Omeprazole",
        "generic_name": "Omeprazole",
        "category": "Proton Pump Inhibitor (PPI)",
        "common_uses": "Treatment of gastroesophageal reflux disease (GERD), frequent heartburn, and stomach acid reduction.",
        "common_side_effects": "Headache, abdominal pain, nausea, diarrhea.",
        "precautions": "Best taken in the morning before eating. Intended for short-term course unless directed by a physician."
    }
}


def get_db_connection():
    if mysql is None:
        raise RuntimeError("mysql-connector-python is not installed")
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "mediguide_ai")
    )


def search_medicine(medicine_name):
    query_name = (medicine_name or "").strip().lower()
    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        query = """
            SELECT
                name,
                generic_name,
                category,
                common_uses,
                common_side_effects,
                precautions
            FROM medicines
            WHERE LOWER(name) = LOWER(%s)
               OR LOWER(generic_name) = LOWER(%s)
            LIMIT 1
        """

        cursor.execute(
            query,
            (medicine_name, medicine_name)
        )

        result = cursor.fetchone()
        if result:
            return result
    except Exception as e:
        print(f"Database lookup notice: {e} - Falling back to local medicine dictionary.")
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()

    # Fallback to local dictionary
    return FALLBACK_MEDICINES.get(query_name)


if __name__ == "__main__":
    medicine = search_medicine("Paracetamol")
    print(medicine)