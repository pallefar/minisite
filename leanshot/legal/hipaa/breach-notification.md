# Breach Notification Policy

**Version:** 1.0
**Last Reviewed:** 2026-05-17
**Next Review Due:** 2027-05-17 (annual)
**Owner:** Founder (Karsten Haldan)
**Applies To:** All LeanShot employees, contractors, and systems processing PHI

## 1. Purpose

Define LeanShot's breach notification obligations and processes under the HIPAA Breach Notification Rule (45 CFR §164.400-414), ensuring timely notice to affected individuals, HHS, and media when required.

## 2. Scope

All breaches of unsecured PHI maintained by LeanShot or its subprocessors, regardless of size. "Breach" means unauthorized acquisition, access, use, or disclosure of PHI that compromises its security or privacy, subject to the four-factor analysis exceptions in 45 CFR §164.402.

## 3. Policy

### 3.1 60-day notification SLA

- **Individual notice**: within 60 days of discovery of a breach (45 CFR §164.404(b))
- **HHS notice**: within 60 days of discovery for breaches affecting 500+ individuals; within 60 days of calendar year end for smaller breaches (annual log) (45 CFR §164.408)
- **Media notice**: within 60 days of discovery if 500+ individuals in a single state or jurisdiction affected (45 CFR §164.406)

The 60-day clock starts from the date LeanShot (or any workforce member) first knows of the breach, even if the full scope is not yet determined.

### 3.2 What must be included in individual notice

Per 45 CFR §164.404(c):

- Brief description of the breach (what happened, approximate date)
- Description of the PHI involved (field types; not actual values)
- Steps individuals should take to protect themselves
- Brief description of LeanShot's investigation and mitigation steps
- Contact information: name, title, phone number, email address for questions

### 3.3 Delivery methods

- **First-class mail** to last known postal address (preferred)
- **Email** if individual has authorized electronic notice AND email address is on file
- **Substitute notice** (if postal address is insufficient for 10+ individuals): prominent web posting for 90 days AND major print/broadcast media in geographic area
- **Phone** may supplement but does not replace written notice

### 3.4 Media notice threshold

If a breach affects 500 or more residents of a single state or jurisdiction, a media notice (press release) must be issued to prominent media outlets serving that state within the 60-day window. Applicable even if individual notice is also sent.

### 3.5 Annual HHS reporting for small breaches

Breaches affecting fewer than 500 individuals must be logged and reported to HHS annually via the HHS Breach Notification Portal no later than 60 days after the end of the calendar year in which they occurred.

## 4. Procedures

### 4.1 Individual notice template

```
Subject: Important Notice About Your Health Information

Dear [Patient Name],

LeanShot Health, Inc. is writing to inform you of an incident involving your 
protected health information.

WHAT HAPPENED
[Brief description of the incident, including the approximate date range.]

WHAT INFORMATION WAS INVOLVED
The following types of information may have been accessed:
[List field types: e.g., name, email address, medication name, dose information]

WHAT WE ARE DOING
[Description of steps taken to investigate and contain the incident, including 
any corrective measures implemented.]

WHAT YOU CAN DO
We recommend that you:
- Monitor your health records for any unauthorized changes
- [Any other relevant protective steps based on PHI involved]

FOR MORE INFORMATION
If you have questions, please contact:
Karsten Haldan, Founder
LeanShot Health, Inc.
Email: [contact email]
Phone: [contact phone]

We sincerely apologize for this incident and any inconvenience it may cause.

Sincerely,
Karsten Haldan
Founder, LeanShot Health, Inc.
```

### 4.2 HHS portal submission process

1. Navigate to: https://ocrportal.hhs.gov/ocr/breach/wizard_breach.jsf
2. Select "Business Associate" or "Covered Entity" as appropriate
3. Complete all required fields (name, state, type of PHI, date of breach, date of discovery, number of individuals, business associates involved)
4. Upload any supporting documentation
5. Submit and retain: confirmation number, submission date, and a PDF copy of the submission
6. Store confirmation at `/legal/hipaa/breach-reports/YYYYMMDD-hhs-confirmation.pdf`

### 4.3 Media notice template

```
FOR IMMEDIATE RELEASE

LeanShot Health Notifies Customers of Data Security Incident

[City, State] - [Date] - LeanShot Health, Inc. today announced a data security 
incident involving the protected health information of [number] individuals in 
[State].

[Description of what happened, when, and what information was involved.]

LeanShot Health has taken the following steps to address this incident:
[List of corrective actions.]

Affected individuals are encouraged to contact LeanShot Health with any questions:
- Email: [contact email]
- Phone: [contact phone]

LeanShot Health is committed to protecting the privacy of its users and apologizes 
for any inconvenience caused by this incident.

###

Contact:
Karsten Haldan, Founder
LeanShot Health, Inc.
[contact email]
[contact phone]
```

### 4.4 Annual HHS log maintenance

Maintain a running log at `/legal/hipaa/breach-reports/annual-log-YYYY.md` with columns:

| Date Discovered | Brief Description | PHI Types | Individuals Affected | HHS Reported? | Date HHS Report Submitted |
|-----------------|-------------------|-----------|---------------------|---------------|--------------------------|

Submit log to HHS by January 31 of the following year for all entries from the prior calendar year.

## 5. Responsibilities

- **Founder**: incident commander; author of all breach notifications; HHS submission sender; media notice coordinator
- **Legal counsel (external)**: review individual notice text and HHS submission before sending when feasible within 60-day window
- **Drata**: evidence collection for breach notification timeline and compliance audit trail

## 6. Enforcement

Failure to provide timely breach notification is a HIPAA violation. HHS civil monetary penalties for failure to notify can reach $100 to $50,000 per violation (up to $1.9M per year per violation category under Tier 4 willful neglect). Proactive notification with root cause remediation is the only defensible posture.

## 7. Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-05-17 | Karsten Haldan | Initial version (Phase 25 Plan 25-10) |
