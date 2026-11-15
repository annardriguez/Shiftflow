# Independent CP-SAT engine

Implemented in Milestone 2. `contracts.py` defines validated inputs/outputs; `candidates.py` prepares finite shift/break alternatives; `model.py` builds real CP-SAT constraints and weighted objectives. `validation.py` recomputes all hard rules and supervision matching without OR-Tools. `metrics.py` independently derives diagnostic and objective values. `service.py` runs strategies from one immutable snapshot.

See ../README.md for local launch/tests and ../../docs/milestone2.md for implemented rules, phase statuses and remaining limits.
