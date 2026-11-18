# Research sources

## Official VEX
- CTE Arm (Python, standalone): https://api.vex.com/cte/home/python/Arm.html
- EXP Arm (Python): https://api.vex.com/exp/home/python/Arm.html
- CTE Signal Tower: https://api.vex.com/cte/home/python/SignalTower.html
- EXP Signal Tower (bumper): https://api.vex.com/exp/home/python/SignalTower.html
- CTE Logic pages: https://api.vex.com/cte/home/python/Logic/{Timer,Control,Threads,Functions}.html
- CTE Blocks: https://api.vex.com/cte/home/blocks/{arm,tower}.html
- V5 C++ CTE Workcell: https://api.vex.com/v5/home/cpp/CTE_Workcell/index.html
- Coordinate system lesson: https://education.vex.com/stemlabs/cte/introduction-to-the-6-axis-arm/introduction-to-robotic-arms/lesson-3-the-coordinate-system-of-the-6-axis-arm
- Kit overview: https://kb.vex.com/hc/en-us/articles/27339074776980-Overview-of-the-CTE-Workcell-Kit
- Troubleshooting: https://kb.vex.com/hc/en-us/articles/32138274956308-Troubleshooting-the-CTE-6-Axis-Arm
- IQ2 Drivetrain: https://api.vex.com/iq2/home/python/Drivetrain.html
- IQ2 Motor: https://api.vex.com/iq2/home/python/Motion/Motor.html

## Community
- A three.js and Pyodide CTE arm simulator with measured link lengths: https://github.com/gabriel975/VEX6AxisArmSimulator

## Access notes
- api.vex.com returns 403 to curl, even with a browser user agent, so use WebFetch.
- Page paths are case-sensitive. Logic pages live under `/python/Logic/`.

## IDE / Teach Pendant / whiteboard
- See docs/specs/teach_pendant_and_ide.md (KB Teach Pendant guide, STEM Labs Unit 1 L4 + Unit 4 L1 screenshots).
