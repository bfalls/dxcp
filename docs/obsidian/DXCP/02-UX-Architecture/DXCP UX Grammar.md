# DXCP UX Grammar  
  
## Purpose  
  
DXCP maintains a consistent user experience by enforcing a clear **UX grammar**.  
  
The grammar defines how the core vocabulary is used to form UI phrases,  
labels, buttons, actions, alerts, and messages.  
  
This ensures the UI reads like a coherent language rather than a collection  
of unrelated interface terms.  
  
The grammar is based on the **DXCP Core Vocabulary**.  
  
Core nouns:  
  
DXCP  
Application  
Environment  
Deployment  
Deployment Strategy  
Deployment Group  
  
---  
  
# UX Grammar Principles  
Terminology used in this document follows the definitions in [[DXCP Core Vocabulary]].
  
## 1. Prefer verbs + core nouns  
  
Most UI actions follow the pattern:  
  
```  
Verb + Core Noun  
```  
  
Examples:  
  
```  
Deploy Application  
Rollback Deployment  
Open Application  
View Deployments  
Inspect Failure  
```  
  
This creates a predictable interface language.  
  
---  
  
## 2. Avoid technical implementation language  
  
Users should never see:  
  
```  
Execute pipeline  
Trigger stage  
Run job  
Submit record  
```  
  
Instead use:  
  
```  
Deploy Application  
Rollback Deployment  
```  
  
DXCP hides engine mechanics.  
  
---  
  
## 3. Prefer short verbs  
  
Buttons and actions should use concise verbs.  
  
Examples:  
  
```  
Deploy  
Rollback  
Open  
Refresh  
View  
Save  
```  
  
Avoid verbose phrases such as:  
  
```  
Initiate Deployment  
Execute Rollback  
Perform Deployment  
```  
  
---  
  
# Primary Verbs  
  
These verbs represent the core actions users perform in DXCP.  
  
```  
Deploy  
Rollback  
Open  
View  
Refresh  
Save  
Cancel  
Inspect  
```  
  
These verbs should be used consistently throughout the UI.  
  
---  
  
# Action Patterns  
  
## Deploy Workflow  
  
```  
Deploy Application  
```  
  
Deploy form example:  
  
```  
Deploy Application  
  
Application: payments-api  
Environment: sandbox  
Strategy: Blue-Green  
Version: v1.32.1  
```  
  
Submit button:  
  
```  
Deploy  
```  
  
---  
  
## Rollback Workflow  
  
Rollback always applies to a **Deployment**.  
  
```  
Rollback Deployment  
```  
  
Confirmation dialog:  
  
```  
Rollback Deployment?  
  
Application: payments-api  
Environment: sandbox  
Rollback target: v1.31.4  
```  
  
Confirm button:  
  
```  
Rollback  
```  
  
---  
  
# Navigation Grammar  
  
Navigation items use **plural nouns** representing collections.  
  
Example navigation:  
  
```  
Applications  
Deployments  
Insights  
Admin  
```  
  
Admin subsections:  
  
```  
Deployment Groups  
Strategies  
System Settings  
Audit Log  
```  
  
Navigation should never use verbs.  
  
Avoid:  
  
```  
Deploy  
Manage  
Run  
Execute  
```  
  
---  
  
# Page Header Grammar  
  
Page headers follow a predictable pattern.  
  
Example:  
  
```  
Application: payments-api  
```  
  
or  
  
```  
Deployment 9831  
```  
  
Actions appear on the right side of the header:  
  
```  
Deploy  
Rollback  
Refresh  
```  
  
---  
  
# Status Grammar  
  
Status indicators should be short and readable.  
  
Examples:  
  
```  
SUCCEEDED  
FAILED  
IN PROGRESS  
ROLLED BACK  
CANCELED  
```  
  
These states are derived from Deployment records.  
  
---  
  
# Timeline Grammar  
  
Timeline entries should read like short sentences.  
  
Example timeline:  
  
```  
Deployment started  
Traffic shift initiated  
Deployment succeeded  
Rollback triggered  
Rollback completed  
```  
  
Avoid engine terminology.  
  
---  
  
# Error and Policy Messages  
  
Messages should explain **what happened** and **why**.  
  
Example policy message:  
  
```  
Deployment blocked by policy  
  
Deployment Group: payments  
Reason: concurrency limit reached  
```  
  
Example validation message:  
  
```  
Deployment blocked  
  
Version not registered for this application.  
```  
  
Error messages should avoid raw API terminology.  
  
---  
  
# Admin Grammar  
  
Admin actions should remain clear but concise.  
  
Examples:  
  
```  
Create Deployment Group  
Edit Strategy  
Save Settings  
View Audit Log  
```  
  
Admin screens may expose additional diagnostics, but the primary  
language should remain consistent with the core vocabulary.  
  
---  
  
# Grammar Consistency Rules  
  
The DXCP UI should follow these rules:  
  
1. Use the core vocabulary nouns.  
2. Combine verbs with those nouns.  
3. Avoid exposing engine terminology.  
4. Prefer short, readable action labels.  
5. Maintain consistent phrasing across screens.  
  
---  
  
# Examples of Correct Language  
  
```  
Deploy Application  
Rollback Deployment  
Open Application  
View Deployments  
Inspect Failure  
```  
  
---  
  
# Examples to Avoid  
  
```  
Execute pipeline  
Trigger job  
Submit deployment record  
Run deployment pipeline  
```  
  
These phrases expose implementation details and violate the intent-first  
design of DXCP.  
  
---  
  
# Why UX Grammar Matters  
  
A strong UX grammar ensures that:  
  
- the system feels predictable  
- users learn the interface quickly  
- terminology remains consistent  
- platform complexity remains hidden  
  
This is one of the reasons platforms such as GitHub feel coherent even  
as they grow in capability.  
  
DXCP should maintain the same level of language discipline.