# Spec: IQ (2nd gen) brain user interface and the VS Code extension (as simulated)

Sources:
- [KB-DEV] https://kb.vex.com/hc/en-us/articles/4407061189908 ("Using the Devices Screen - IQ Brain (2nd gen)")
- [KB-VSUI] https://kb.vex.com/hc/en-us/articles/8604273158164 (VS Code UI Overview for IQ)
- [KB-VSNEW] https://kb.vex.com/hc/en-us/articles/8604236587028 (VS Code New Project for IQ)
- [KB-AIR] https://kb.vex.com/hc/en-us/articles/39233320977812 (project files: `.vscode/{extensions,settings,vex_project_settings}.json` and `src/main.py`)
- [MKT] https://marketplace.visualstudio.com/items?itemName=VEXRobotics.vexcode

## Brain (frontend `src/iq2/brainOS.ts`)
- **Buttons:** Check, X, Left and Right. The API exposes Check, Left and Right; X is the system's stop and back button.
  - Keyboard: Enter, Backspace, ← and →.
- **Home menu:** Programs, Drive, Devices, Settings [KB-DEV says "Devices is the third option in the Home menu"].
  - Left and Right move the selection, Check opens an item.
  - Drive is shown but disabled, because the IQ Controller is not simulated.
- **Programs:** slots 1 to 8. The slot count comes from the VS Code Slot Selector, which offers "user program slots 1-8" [KB-VSUI].
  - Check runs the selected slot.
  - While a program runs, the screen shows the program's output and Check, Left and Right go to the program.
  - X stops the program and returns to Programs.
  - When a program finishes, its last screen stays up until you press X.
- **Devices:** a 12-port grid of what is plugged in. Check shows live values for the selected port [KB-DEV].
- **Settings:** brain name, battery, heading and VEXos version.
- **Where slots live:** downloaded programs are stored in this browser (localStorage), not on the server.

## VS Code + VEX extension look-alike (frontend `src/iq2/codeTab.ts`)
- **Theme:** VS Code's Dark Modern colours, with a menu bar, activity bar, side bar, editor tabs, breadcrumbs and a panel.
- **Activity bar:** Explorer, Search (disabled) and VEX.
- **VEX view:**
  - **Project Actions:** New Project and Import Project [KB-VSUI].
  - **VEX Device Info:** a Brain tree with System (name, which is editable, and VEXos), Programs (slots, with erase) and Devices (from the Build tab).
  - **Lab Programs:** the examples index. Opening one creates a project and also applies its robot preset and map.
  - **Projects:** projects saved in this browser.
- **New Project wizard** [KB-VSNEW]:
  1. **Platform:** only IQ 2nd Generation is enabled; V5, EXP and AIM are shown greyed out.
  2. **Language:** Python. C++ is greyed out.
  3. **Template:** searchable. Choices are Empty Project, Drivetrain 2-motor and All sensors.
  4. **Details:** Name, Description, SDK and Location. SDK and Location are shown but fixed.
- **Files created** [KB-AIR]:
  - `.vscode/vex_project_settings.json`. Its keys (project name, description, platform, language, slot, sdkVersion and python.main) are an ESTIMATE.
  - `.vscode/settings.json` and `.vscode/extensions.json`.
  - `src/main.py` with the VS Code module banner comment.
- **Status-bar toolbar** [KB-VSUI]:
  - Device Picker, Slot Selector (1–8), Download, Play, Stop, Project Selector and Python File Selector.
  - Download writes the selected Python file to the slot, printing log lines like the extension's ("Download User Program", "Download Finished").
  - Play runs the slot on the simulated brain and switches to the Simulator tab.
- **Terminals:** "Log Terminal" for download output, and "Interactive Terminal" for program `print`. The Interactive Terminal is cleared after a download, as in the extension's default.
- **Problems tab:** runtime errors with their line numbers. The editor highlights the error line.
