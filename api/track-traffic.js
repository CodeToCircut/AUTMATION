import fetch from 'node-fetch';

// 1. ADD YOUR REPOSITORY NAMES HERE
const REPOSITORIES = [
  "my-first-arduino-project",
  "rfid-electronic-safe",
  "motion-sensor-fan-shorts"
];

export default async function handler(req, res) {
  // Grab our environment tokens
  const githubToken = process.env.GITHUB_PAT;
  const notionToken = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  const username = process.env.GITHUB_USERNAME;

  const today = new Date().toISOString().split('T')[0];
  const logs = [];

  try {
    for (const repo of REPOSITORIES) {
      // Fetch views from GitHub Traffic API
      const ghResponse = await fetch(`https://api.github.com/repos/${username}/${repo}/traffic/views`, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${githubToken}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (!ghResponse.ok) {
        throw new Error(`GitHub error for ${repo}: ${ghResponse.statusText}`);
      }

      const trafficData = await ghResponse.json();
      const totalViews = trafficData.count || 0;
      const uniqueVisitors = trafficData.uniques || 0;

      // Push payload into Notion Database
      const notionResponse = await fetch('https://api.github.com/notion/v1/pages', { // Note: If using direct Notion API, endpoint is https://api.notion.com/v1/pages
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties: {
            "Name": { title: [{ text: { content: today } }] },
            "Repository": { rich_text: [{ text: { content: repo } }] },
            "Total Views": { number: totalViews },
            "Unique Visitors": { number: uniqueVisitors }
          }
        })
      });

      logs.push(`${repo}: logged ${totalViews} views, ${uniqueVisitors} uniques.`);
    }

    return res.status(200).json({ success: true, processed: logs });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
} 
