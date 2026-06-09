import os
import re
import subprocess
import sys
from typing import TypedDict
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

# ==========================================
# 1. Setup & Model Configuration
# ==========================================
llm = ChatOpenAI(
    model="nemotron3:33b", 
    base_url="http://localhost:11434/v1",
    api_key="ollama"
)

# Ensure all output files are saved in the current working directory
OUTPUT_DIR = os.getcwd()

# ==========================================
# 2. State Definition (Memory of the Graph)
# ==========================================
class AppState(TypedDict):
    raw_requirements: str    # Initial user prompt
    proposal: str            # Formal development proposal
    code_output: str         # Generated code from Engineer
    feedback: str            # Rejection feedback from QA or PM
    qa_approved: bool        # QA status
    pm_approved: bool        # PM status
    iteration_count: int     # Loop safety counter
    handoff_log: str         # FINAL HANDOFF DOCUMENT (New!)

# ==========================================
# 3. Nodes (Agent Roles)
# ==========================================

def planner_node(state: AppState) -> AppState:
    print("\n📝 [Architect/PM] Converting raw requirements into a formal Development Proposal...")
    prompt = f"""
    You are an elite Tech Lead & Product Manager.
    Raw Requirement: {state['raw_requirements']}
    Task: Write a comprehensive "Development Proposal".
    CRITICAL: The output MUST be entirely in Traditional Chinese (繁體中文).
    
    Structure must include:
    1. Vision & Core Solution
    2. System Architecture (Backend: FastAPI, Frontend: React Native)
    3. UI/UX Core Philosophy (Emphasize "Visual Priority Weighting", NO traditional lists)
    4. Database Schema
    5. API & Anti-Interruption Logic
    """
    proposal = llm.invoke([HumanMessage(content=prompt)]).content
    return {"proposal": proposal}

def engineer_node(state: AppState) -> AppState:
    print(f"\n👨‍💻 [Engineer] Writing code based on proposal (Iteration {state['iteration_count'] + 1})...")
    context = f"Feedback to fix: {state['feedback']}" if state['feedback'] else "Write initial code based on proposal."
    prompt = f"""
    You are an elite Full-Stack Engineer.
    Task: Build the 'Sync-Us' app based strictly on this Development Proposal:
    {state['proposal']}
    
    Context: {context}
    
    CRITICAL INSTRUCTION FOR OUTPUT:
    You MUST output the FastAPI code enclosed in a ```python ... ``` block.
    You MUST output the React Native code enclosed in a ```javascript ... ``` block.
    Do NOT mix them. Ensure all user-facing UI strings are in Traditional Chinese (繁體中文).
    """
    response = llm.invoke([HumanMessage(content=prompt)])
    return {
        "code_output": response.content,
        "iteration_count": state["iteration_count"] + 1,
        "feedback": "" 
    }

def qa_tester_node(state: AppState) -> AppState:
    print("\n🕵️‍♂️ [QA Tester] Running code stress tests and debugging...")
    prompt = f"""
    You are a strict QA Tester. Review this code against the proposal.
    Code: {state['code_output']}
    Proposal: {state['proposal']}
    
    Checklist:
    1. Are both python and javascript code blocks present?
    2. Does the Python backend actually implement the 'anti-interruption logic' to check for schedule conflicts?
    
    If it passes, reply ONLY with "PASS".
    If it fails, reply with "FAIL: [Detailed bug report]".
    """
    response = llm.invoke([HumanMessage(content=prompt)]).content
    if response.strip().startswith("PASS"):
        print("✅ QA Test Passed!")
        return {"qa_approved": True, "feedback": ""}
    else:
        print("❌ QA found bugs, returning to Engineer!")
        return {"qa_approved": False, "feedback": response}

def pm_review_node(state: AppState) -> AppState:
    print("\n👔 [PM] Conducting final architectural review...")
    prompt = f"""
    You are the PM. Review the QA-approved code:
    {state['code_output']}
    
    Checklist:
    1. Did they avoid traditional To-Do list UI?
    2. Is the 'Visual priority weighting' actually implemented in the React Native UI?
    
    If it matches the vision, reply ONLY with "PASS".
    If it fails, reply with "FAIL: [Architectural feedback]".
    """
    response = llm.invoke([HumanMessage(content=prompt)]).content
    if response.strip().startswith("PASS"):
        print("✅ PM Review Passed! Moving to Documenter...")
        return {"pm_approved": True, "feedback": ""}
    else:
        print("❌ PM rejected the UI logic, returning to Engineer!")
        return {"pm_approved": False, "feedback": response}

def documenter_node(state: AppState) -> AppState:
    print("\n📚 [Technical Writer] Creating Project Handoff Documentation for human takeover...")
    prompt = f"""
    You are a Lead Technical Writer handling the project handoff to the human Senior Engineer.
    The project is approved. 
    Code generated: {state['code_output']}
    
    Task: Write a "Handoff & Architecture Log" explaining exactly what files were created and their relationships.
    CRITICAL: The output MUST be entirely in Traditional Chinese (繁體中文).
    
    Include:
    1. 檔案總覽 (File Overview): Mention exactly '01_Sync-Us_Proposal.md', '02_backend_main.py', and '03_frontend_App.js'.
    2. 架構關係 (Architecture Relationships): Explain how the frontend React Native code communicates with the FastAPI backend, and how data flows.
    3. 接手指南 (Handoff Guide): What the human engineer should look at first to take over the project.
    """
    handoff = llm.invoke([HumanMessage(content=prompt)]).content
    print("✅ Handoff Documentation generated!")
    return {"handoff_log": handoff}

# ==========================================
# 4. Routing Logic (Edges)
# ==========================================

def route_after_qa(state: AppState) -> str:
    if state["iteration_count"] >= 5: return "end"
    if state["qa_approved"]: return "to_pm"
    return "to_engineer"

def route_after_pm(state: AppState) -> str:
    if state["iteration_count"] >= 5: return "end"
    if state["pm_approved"]: return "to_documenter" # Move to Documenter upon success
    return "to_engineer"

# ==========================================
# 5. Graph Assembly
# ==========================================
workflow = StateGraph(AppState)

workflow.add_node("Planner", planner_node)
workflow.add_node("Engineer", engineer_node)
workflow.add_node("QATester", qa_tester_node)
workflow.add_node("PM", pm_review_node)
workflow.add_node("Documenter", documenter_node) # Add Documenter Node

workflow.set_entry_point("Planner") 
workflow.add_edge("Planner", "Engineer")
workflow.add_edge("Engineer", "QATester")
workflow.add_conditional_edges("QATester", route_after_qa, {"to_pm": "PM", "to_engineer": "Engineer", "end": END})
workflow.add_conditional_edges("PM", route_after_pm, {"to_documenter": "Documenter", "to_engineer": "Engineer", "end": END})
workflow.add_edge("Documenter", END) # End graph after documentation

app = workflow.compile()

# ==========================================
# 6. Execution & Auto-Deployment
# ==========================================
if __name__ == "__main__":
    print(f"🚀 Starting Full SDLC Agent Team... (Working Directory: {OUTPUT_DIR})")
    
    initial_state = {
        "raw_requirements": "I want to build a to-do app for couples to prevent my partner from randomly interrupting my schedule. It needs a frictionless input method and a 'visual priority weight' card system to block low-priority tasks from displacing high-priority ones. No traditional lists.",
        "proposal": "", "code_output": "", "feedback": "", "qa_approved": False, "pm_approved": False, "iteration_count": 0, "handoff_log": ""
    }
    
    final_state = app.invoke(initial_state)
    
    print("\n📦 Extracting files and archiving...")

    # Save 0: Handoff Document (NEW!)
    if final_state.get("handoff_log"):
        file_0 = os.path.join(OUTPUT_DIR, "00_Handoff_Log.md")
        with open(file_0, "w", encoding="utf-8") as f:
            f.write(final_state["handoff_log"])
        print("📄 Created: 00_Handoff_Log.md (Your manual to take over!)")

    # Save 1: Development Proposal
    file_1 = os.path.join(OUTPUT_DIR, "01_Sync-Us_Proposal.md")
    with open(file_1, "w", encoding="utf-8") as f:
        f.write(final_state["proposal"])
    print("📄 Created: 01_Sync-Us_Proposal.md")

    code_md = final_state["code_output"]

    # Save 2: Backend Code
    backend_match = re.search(r'```python\n(.*?)```', code_md, re.DOTALL)
    if backend_match:
        file_2 = os.path.join(OUTPUT_DIR, "02_backend_main.py")
        with open(file_2, "w", encoding="utf-8") as f:
            f.write(backend_match.group(1).strip())
        print("📄 Created: 02_backend_main.py")

    # Save 3: Frontend Code
    frontend_match = re.search(r'```(?:javascript|js|jsx)\n(.*?)```', code_md, re.DOTALL)
    if frontend_match:
        file_3 = os.path.join(OUTPUT_DIR, "03_frontend_App.js")
        with open(file_3, "w", encoding="utf-8") as f:
            f.write(frontend_match.group(1).strip())
        print("📄 Created: 03_frontend_App.js")

    # Save 4: Complete Debug Log
    file_4 = os.path.join(OUTPUT_DIR, "04_Debug_Log.md")
    with open(file_4, "w", encoding="utf-8") as f:
        f.write(f"Total Iterations: {final_state['iteration_count']}\n\n---\n\n" + code_md)
    print("📄 Created: 04_Debug_Log.md")

    print("\n🌍 Installing dependencies and starting FastAPI server...")
    subprocess.run([sys.executable, "-m", "pip", "install", "fastapi", "uvicorn", "pydantic", "sqlalchemy"], stdout=subprocess.DEVNULL, check=False)
    
    if backend_match:
        print("👉 API Test URL: http://localhost:8000/docs")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "fastapi", "uvicorn", "pydantic", "sqlalchemy", "asyncpg"], stdout=subprocess.DEVNULL, check=False)
        except KeyboardInterrupt:
            print("\n🛑 Server stopped manually.")
