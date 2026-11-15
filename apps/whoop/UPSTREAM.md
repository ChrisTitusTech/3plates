Imported from ChrisTitusTech/gallant-dashboard at 9367c25db5abac97781655a2ebe6a4984d1cbd1c (MIT).

This workspace owns the integrated WHOOP service, worker, compatibility dashboard, and tests. Existing production data and encryption keys must be retained. Never run integration tests against production. The legacy dashboard remains compatible during rollout. Deployment must use one sequential SSH session; do not create a separate master connection on the constrained VPS.
